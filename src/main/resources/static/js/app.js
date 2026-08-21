/**
 * 4 Eyes App — Main Application Logic
 *
 * Handles:
 *  - WebRTC peer connection (phone ↔ computer)
 *  - WebSocket signaling
 *  - Frame capture & LLM analysis
 *  - Text-to-Speech output
 */
(function () {
    'use strict';

    // ==========================================
    //  STATE
    // ==========================================
    let ws = null;
    let peerConnection = null;
    let localStream = null;
    let offerCreated = false;
    let autoAnalyzeTimer = null;
    let currentFacingMode = 'environment'; // rear camera by default
    let isAnalyzing = false;

    const ICE_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

    // ==========================================
    //  INIT
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof ROLE === 'undefined' || typeof ROOM_ID === 'undefined') return;

        if (ROLE === 'sender') {
            initSender();
        } else if (ROLE === 'viewer') {
            initViewer();
        }
    });

    // ==========================================
    //  SENDER (Phone Camera)
    // ==========================================
    async function initSender() {
        try {
            updateStatus('Starting camera...');

            localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            const video = document.getElementById('localVideo');
            video.srcObject = localStream;
            hideOverlay();

            updateStatus('Connecting to room...');
            connectWebSocket();
            setupCameraControls();

        } catch (err) {
            console.error('Camera error:', err);
            updateStatus('Camera error', 'error');
            const overlay = document.getElementById('videoOverlay');
            if (overlay) {
                overlay.querySelector('p').textContent =
                    'Camera access denied. Please allow camera permissions and reload.';
            }
        }
    }

    function setupCameraControls() {
        const flipBtn = document.getElementById('btnFlipCamera');
        const toggleBtn = document.getElementById('btnToggleCamera');

        if (flipBtn) {
            flipBtn.addEventListener('click', async () => {
                currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
                try {
                    const newStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: currentFacingMode,
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        },
                        audio: false
                    });

                    const oldTrack = localStream.getVideoTracks()[0];
                    const newTrack = newStream.getVideoTracks()[0];

                    // Replace track in the peer connection if active
                    if (peerConnection) {
                        const sender = peerConnection.getSenders()
                            .find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            await sender.replaceTrack(newTrack);
                        }
                    }

                    oldTrack.stop();
                    localStream.removeTrack(oldTrack);
                    localStream.addTrack(newTrack);

                    document.getElementById('localVideo').srcObject = localStream;
                } catch (err) {
                    console.error('Failed to flip camera:', err);
                    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
                }
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const track = localStream.getVideoTracks()[0];
                if (track) {
                    track.enabled = !track.enabled;
                    toggleBtn.textContent = track.enabled ? '📷 Camera On' : '📷 Camera Off';
                }
            });
        }
    }

    // ==========================================
    //  VIEWER (Computer)
    // ==========================================
    function initViewer() {
        updateStatus('Connecting to room...');
        connectWebSocket();
        setupAnalyzeControls();
        setupTTSControls();
    }

    function setupAnalyzeControls() {
        const btnAnalyze = document.getElementById('btnAnalyze');
        const autoAnalyzeCheckbox = document.getElementById('autoAnalyze');
        const autoIntervalSelect = document.getElementById('autoInterval');

        if (btnAnalyze) {
            btnAnalyze.addEventListener('click', () => analyzeFrame());
            
            // Add spacebar shortcut to trigger analysis
            document.addEventListener('keydown', (e) => {
                if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault(); // Prevent page scroll
                    if (!btnAnalyze.disabled) {
                        analyzeFrame();
                    }
                }
            });
        }

        if (autoAnalyzeCheckbox) {
            autoAnalyzeCheckbox.addEventListener('change', () => {
                if (autoAnalyzeCheckbox.checked) {
                    const interval = parseInt(autoIntervalSelect.value);
                    startAutoAnalyze(interval);
                } else {
                    stopAutoAnalyze();
                }
            });
        }

        if (autoIntervalSelect) {
            autoIntervalSelect.addEventListener('change', () => {
                if (autoAnalyzeCheckbox && autoAnalyzeCheckbox.checked) {
                    stopAutoAnalyze();
                    startAutoAnalyze(parseInt(autoIntervalSelect.value));
                }
            });
        }
    }

    function setupTTSControls() {
        const btnSpeak = document.getElementById('btnSpeak');
        const btnStop = document.getElementById('btnStopSpeak');

        if (btnSpeak) {
            btnSpeak.addEventListener('click', () => {
                const el = document.querySelector('.response-text');
                if (el) speak(el.textContent);
            });
        }

        if (btnStop) {
            btnStop.addEventListener('click', () => {
                speechSynthesis.cancel();
                const el = document.querySelector('.response-text.speaking');
                if (el) el.classList.remove('speaking');
            });
        }
    }

    // ==========================================
    //  WEBSOCKET SIGNALING
    // ==========================================
    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/ws/signal`;

        console.log('Connecting to WebSocket:', wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            updateStatus('Joining room...');

            ws.send(JSON.stringify({
                type: 'join',
                roomId: ROOM_ID,
                role: ROLE,
                peerId: crypto.randomUUID()
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSignal(data);
            } catch (e) {
                console.error('Failed to parse signal:', e);
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            updateStatus('Disconnected — reconnecting...', 'error');

            setTimeout(() => {
                if (!ws || ws.readyState === WebSocket.CLOSED) {
                    console.log('Reconnecting...');
                    offerCreated = false;
                    connectWebSocket();
                }
            }, 3000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    function sendSignal(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function handleSignal(data) {
        switch (data.type) {
            case 'room-info':
                onRoomInfo(data);
                break;
            case 'offer':
                onOffer(data);
                break;
            case 'answer':
                onAnswer(data);
                break;
            case 'ice-candidate':
                onIceCandidate(data);
                break;
            case 'peer-left':
                onPeerLeft(data);
                break;
            default:
                console.log('Unknown signal type:', data.type);
        }
    }

    // ==========================================
    //  SIGNALING HANDLERS
    // ==========================================
    function onRoomInfo(data) {
        console.log('Room info — peers:', data.peerCount);

        if (data.peerCount >= 2) {
            updateStatus('Connected — streaming', 'connected');

            // Sender creates offer when both peers are present
            if (ROLE === 'sender' && !offerCreated && localStream) {
                offerCreated = true;
                createOffer();
            }
        } else {
            updateStatus('Waiting for other device...', 'waiting');
        }
    }

    function onPeerLeft(data) {
        console.log('Peer left — remaining:', data.peerCount);
        updateStatus('Other device disconnected', 'error');
        offerCreated = false;

        // Clean up peer connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }

        if (ROLE === 'viewer') {
            showOverlay('Waiting for camera to reconnect...');
            const btn = document.getElementById('btnAnalyze');
            if (btn) btn.disabled = true;
            stopAutoAnalyze();
        }
    }

    // ==========================================
    //  WEBRTC
    // ==========================================
    function createPeerConnection() {
        if (peerConnection) {
            peerConnection.close();
        }

        peerConnection = new RTCPeerConnection(ICE_CONFIG);

        // Send ICE candidates to remote peer
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({
                    type: 'ice-candidate',
                    roomId: ROOM_ID,
                    candidate: event.candidate
                });
            }
        };

        // Monitor connection state
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            console.log('ICE state:', state);

            switch (state) {
                case 'connected':
                case 'completed':
                    updateStatus('Stream connected', 'connected');
                    break;
                case 'disconnected':
                    updateStatus('Stream interrupted...', 'error');
                    break;
                case 'failed':
                    updateStatus('Connection failed — try refreshing', 'error');
                    break;
            }
        };

        // VIEWER: handle incoming remote track
        if (ROLE === 'viewer') {
            peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event.track.kind);
                const video = document.getElementById('remoteVideo');
                video.srcObject = event.streams[0];
                hideOverlay();

                // Enable analyze
                const btn = document.getElementById('btnAnalyze');
                if (btn) btn.disabled = false;
            };
        }

        // SENDER: add local camera tracks
        if (ROLE === 'sender' && localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        return peerConnection;
    }

    async function createOffer() {
        console.log('Creating WebRTC offer...');
        createPeerConnection();

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            sendSignal({
                type: 'offer',
                roomId: ROOM_ID,
                sdp: peerConnection.localDescription
            });

            console.log('Offer sent');
        } catch (err) {
            console.error('Error creating offer:', err);
            updateStatus('Failed to create offer', 'error');
        }
    }

    async function onOffer(data) {
        if (ROLE !== 'viewer') return;
        console.log('Received offer, creating answer...');

        createPeerConnection();

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            sendSignal({
                type: 'answer',
                roomId: ROOM_ID,
                sdp: peerConnection.localDescription
            });

            console.log('Answer sent');
        } catch (err) {
            console.error('Error handling offer:', err);
        }
    }

    async function onAnswer(data) {
        if (ROLE !== 'sender') return;
        console.log('Received answer');

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (err) {
            console.error('Error setting answer:', err);
        }
    }

    async function onIceCandidate(data) {
        if (!peerConnection) return;

        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            // Non-critical — some candidates may arrive late
            console.warn('Error adding ICE candidate:', err.message);
        }
    }

    // ==========================================
    //  FRAME CAPTURE & LLM ANALYSIS
    // ==========================================
    function captureFrame() {
        const video = document.getElementById('remoteVideo');
        if (!video || !video.videoWidth || video.readyState < 2) return null;

        const canvas = document.getElementById('captureCanvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        // Return base64 (strip "data:image/jpeg;base64," prefix)
        return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    }

    async function analyzeFrame() {
        if (isAnalyzing) return;

        const image = captureFrame();
        if (!image) {
            showResponse('⚠️ No video frame available. Make sure the camera is streaming.');
            return;
        }

        const btnAnalyze = document.getElementById('btnAnalyze');
        const responseBody = document.getElementById('responseBody');
        const customPrompt = document.getElementById('customPrompt');

        isAnalyzing = true;

        // Loading state
        if (btnAnalyze) {
            btnAnalyze.disabled = true;
            btnAnalyze.innerHTML = '<div class="loading-spinner" style="width:20px;height:20px;border-width:2px;"></div> Analyzing...';
        }

        responseBody.innerHTML =
            '<div class="analyzing-indicator">' +
            '<div class="loading-spinner" style="width:24px;height:24px;border-width:2px;"></div>' +
            '<span>Analyzing frame with AI...</span></div>';

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: image,
                    prompt: customPrompt ? customPrompt.value.trim() || null : null
                })
            });

            const data = await response.json();

            if (data.success) {
                showResponse(data.response);
                addToHistory(data.response);

                // Auto-speak
                const autoSpeak = document.getElementById('autoSpeak');
                if (autoSpeak && autoSpeak.checked) {
                    speak(data.response);
                }

                const btnSpeak = document.getElementById('btnSpeak');
                if (btnSpeak) btnSpeak.disabled = false;
            } else {
                showResponse('⚠️ Error: ' + (data.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Analysis error:', err);
            showResponse('⚠️ Failed to connect to server: ' + err.message);
        } finally {
            isAnalyzing = false;
            if (btnAnalyze) {
                btnAnalyze.disabled = false;
                btnAnalyze.innerHTML = '<span class="btn-icon-left">🧠</span> Analyze';
            }
        }
    }

    function startAutoAnalyze(intervalMs) {
        stopAutoAnalyze();
        autoAnalyzeTimer = setInterval(() => analyzeFrame(), intervalMs);
        console.log('Auto-analyze: every', intervalMs / 1000, 's');
    }

    function stopAutoAnalyze() {
        if (autoAnalyzeTimer) {
            clearInterval(autoAnalyzeTimer);
            autoAnalyzeTimer = null;
        }
    }

    // ==========================================
    //  TEXT-TO-SPEECH
    // ==========================================
    function speak(text) {
        if (!('speechSynthesis' in window)) {
            console.warn('Speech synthesis not supported');
            return;
        }

        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Prefer a natural-sounding English voice
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v =>
            v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel')
        ) || voices.find(v => v.lang.startsWith('en'));

        if (preferred) utterance.voice = preferred;

        // Visual feedback while speaking
        const responseEl = document.querySelector('.response-text');
        if (responseEl) responseEl.classList.add('speaking');

        utterance.onend = () => {
            if (responseEl) responseEl.classList.remove('speaking');
        };
        utterance.onerror = () => {
            if (responseEl) responseEl.classList.remove('speaking');
        };

        speechSynthesis.speak(utterance);
    }

    // Pre-load voices (some browsers need this)
    if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.getVoices();
        speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }

    // ==========================================
    //  UI HELPERS
    // ==========================================
    function updateStatus(text, state) {
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.textContent = text;
        if (indicator) indicator.className = 'status-indicator' + (state ? ' ' + state : '');
    }

    function showResponse(text) {
        const body = document.getElementById('responseBody');
        if (body) body.innerHTML = '<div class="response-text">' + escapeHtml(text) + '</div>';
    }

    function addToHistory(text) {
        const history = document.getElementById('responseHistory');
        if (!history) return;

        const time = new Date().toLocaleTimeString();
        const preview = text; // No truncation, show full text

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML =
            '<div class="history-time">' + escapeHtml(time) + '</div>' +
            '<div class="history-text">' + escapeHtml(preview) + '</div>';

        item.addEventListener('click', () => {
            showResponse(text);
            speak(text);
        });

        history.insertBefore(item, history.firstChild);

        // Cap history at 20 items
        while (history.children.length > 20) {
            history.removeChild(history.lastChild);
        }
    }

    function hideOverlay() {
        const overlay = document.getElementById('videoOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function showOverlay(message) {
        const overlay = document.getElementById('videoOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            const p = overlay.querySelector('p');
            if (p) p.textContent = message;
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
