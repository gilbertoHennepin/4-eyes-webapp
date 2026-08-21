package com.foureyes.app.handler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Handles WebRTC signaling between phone (sender) and computer (viewer).
 * 
 * Message types:
 *   join          → Joins a room
 *   offer/answer  → WebRTC SDP exchange
 *   ice-candidate → WebRTC ICE candidate exchange
 * 
 * All non-join messages are relayed to other peers in the same room.
 */
@Component
public class SignalingHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SignalingHandler.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    /** roomId → set of WebSocket sessions in that room */
    private final ConcurrentHashMap<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    /** sessionId → roomId (for cleanup on disconnect) */
    private final ConcurrentHashMap<String, String> sessionRooms = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket connected: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode json = mapper.readTree(message.getPayload());
        String type = json.has("type") ? json.get("type").asText() : "";
        String roomId = json.has("roomId") ? json.get("roomId").asText() : "";

        if (roomId.isEmpty()) {
            log.warn("Received message without roomId from session {}", session.getId());
            return;
        }

        switch (type) {
            case "join" -> handleJoin(session, roomId, json);
            default -> relayToOthers(session, roomId, message);
        }
    }

    private void handleJoin(WebSocketSession session, String roomId, JsonNode json) throws IOException {
        // Leave previous room if any
        leaveCurrentRoom(session);

        // Join new room
        rooms.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet()).add(session);
        sessionRooms.put(session.getId(), roomId);

        Set<WebSocketSession> room = rooms.get(roomId);
        int peerCount = (int) room.stream().filter(WebSocketSession::isOpen).count();

        log.info("Session {} joined room '{}'. Peer count: {}", session.getId(), roomId, peerCount);

        // Broadcast room-info to ALL peers (including the one that just joined)
        ObjectNode roomInfo = mapper.createObjectNode();
        roomInfo.put("type", "room-info");
        roomInfo.put("peerCount", peerCount);

        TextMessage infoMsg = new TextMessage(mapper.writeValueAsString(roomInfo));
        for (WebSocketSession peer : room) {
            if (peer.isOpen()) {
                synchronized (peer) {
                    peer.sendMessage(infoMsg);
                }
            }
        }
    }

    /**
     * Relay a signaling message to all OTHER peers in the room (not the sender).
     */
    private void relayToOthers(WebSocketSession sender, String roomId, TextMessage message) throws IOException {
        Set<WebSocketSession> room = rooms.get(roomId);
        if (room == null) return;

        for (WebSocketSession peer : room) {
            if (peer.isOpen() && !peer.getId().equals(sender.getId())) {
                synchronized (peer) {
                    peer.sendMessage(message);
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("WebSocket disconnected: {} (status: {})", session.getId(), status);
        String roomId = leaveCurrentRoom(session);

        if (roomId != null) {
            Set<WebSocketSession> room = rooms.get(roomId);
            if (room != null && !room.isEmpty()) {
                try {
                    int peerCount = (int) room.stream().filter(WebSocketSession::isOpen).count();

                    ObjectNode notification = mapper.createObjectNode();
                    notification.put("type", "peer-left");
                    notification.put("peerCount", peerCount);

                    TextMessage msg = new TextMessage(mapper.writeValueAsString(notification));
                    for (WebSocketSession peer : room) {
                        if (peer.isOpen()) {
                            synchronized (peer) {
                                peer.sendMessage(msg);
                            }
                        }
                    }
                } catch (IOException e) {
                    log.error("Error notifying peers about disconnect", e);
                }
            }
        }
    }

    /**
     * Remove a session from its current room and clean up.
     */
    private String leaveCurrentRoom(WebSocketSession session) {
        String roomId = sessionRooms.remove(session.getId());
        if (roomId != null) {
            Set<WebSocketSession> room = rooms.get(roomId);
            if (room != null) {
                room.remove(session);
                if (room.isEmpty()) {
                    rooms.remove(roomId);
                    log.info("Room '{}' is now empty and removed", roomId);
                }
            }
        }
        return roomId;
    }
}
