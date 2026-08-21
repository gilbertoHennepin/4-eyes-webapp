package com.foureyes.app.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class PageController {

    @GetMapping("/")
    public String index() {
        return "index";
    }

    @GetMapping("/phone")
    public String phone(@RequestParam String room, Model model) {
        model.addAttribute("room", room);
        return "phone";
    }

    @GetMapping("/viewer")
    public String viewer(@RequestParam String room, Model model) {
        model.addAttribute("room", room);
        return "viewer";
    }
}
