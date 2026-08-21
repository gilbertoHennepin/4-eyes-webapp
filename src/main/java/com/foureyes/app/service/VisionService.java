package com.foureyes.app.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

/**
 * Calls the Google Gemini API with vision (image) support.
 * Uses gemini-1.5-flash by default, configurable via gemini.model property.
 */
@Service
public class VisionService {

    private static final Logger log = LoggerFactory.getLogger(VisionService.class);

    @Value("${gemini.api-key:}")
    private String apiKey;

    @Value("${gemini.model:gemini-flash-latest}")
    private String model;

    private final RestClient restClient;

    public VisionService(RestClient.Builder restClientBuilder) {
        this.restClient = restClientBuilder
                .baseUrl("https://generativelanguage.googleapis.com/v1beta")
                .build();
    }

    /**
     * Analyze a base64-encoded image using Gemini.
     *
     * @param base64Image The JPEG image encoded as base64 (without data URL prefix)
     * @param userPrompt  Optional prompt to guide analysis; null uses default
     * @return The LLM's text response
     */
    @SuppressWarnings("unchecked")
    public String analyzeImage(String base64Image, String userPrompt) {
        if (apiKey == null || apiKey.isBlank()) {
            return "⚠\uFE0F Gemini API key not configured. "
                    + "Set the GEMINI_API_KEY environment variable and restart the server.";
        }

        String prompt = (userPrompt != null && !userPrompt.isBlank())
                ? userPrompt
                : "If there is a question, problem, or equation in the image, provide only the answer or solution. Do NOT describe what you see or the contents of the image. Just give the answer. Be extremely concise and direct.";

        String fullPrompt = "You are a helpful assistant that analyzes images. "
                + "Be concise, direct, and speak naturally as your response will be read aloud via text-to-speech. "
                + "Avoid markdown formatting, bullet points, or special characters.\n\n"
                + prompt;

        Map<String, Object> request = Map.of(
                "contents", List.of(
                        Map.of("parts", List.of(
                                Map.of("text", fullPrompt),
                                Map.of("inlineData", Map.of(
                                        "mimeType", "image/jpeg",
                                        "data", base64Image
                                ))
                        ))
                )
        );

        log.info("Sending image to {} for analysis...", model);

        try {
            Map<String, Object> response = restClient.post()
                    .uri("/models/" + model + ":generateContent?key=" + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(Map.class);

            if (response == null) {
                return "Error: No response from Gemini API.";
            }

            List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
            if (candidates == null || candidates.isEmpty()) {
                return "Error: No candidates in API response.";
            }

            Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
            List<Map<String, Object>> parts = (List<Map<String, Object>>) content.get("parts");
            String responseText = (String) parts.get(0).get("text");

            log.info("LLM response received ({} chars)", responseText.length());
            return responseText;

        } catch (Exception e) {
            log.error("Gemini API call failed", e);
            return "Error calling Gemini API: " + e.getMessage();
        }
    }
}
