package com.foureyes.app.controller;

import com.foureyes.app.service.VisionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class VisionController {

    private final VisionService visionService;

    public VisionController(VisionService visionService) {
        this.visionService = visionService;
    }

    /**
     * Accepts a base64-encoded image and optional prompt,
     * sends to LLM vision model, returns text analysis.
     */
    @PostMapping("/analyze")
    public ResponseEntity<Map<String, Object>> analyze(@RequestBody Map<String, String> request) {
        try {
            String image = request.get("image");
            String prompt = request.getOrDefault("prompt", null);

            if (image == null || image.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of(
                        "error", "No image provided",
                        "success", false
                ));
            }

            String result = visionService.analyzeImage(image, prompt);
            return ResponseEntity.ok(Map.of(
                    "response", result,
                    "success", true
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", e.getMessage() != null ? e.getMessage() : "Unknown error",
                    "success", false
            ));
        }
    }
}
