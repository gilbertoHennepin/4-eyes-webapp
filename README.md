# 4 Eyes App 🖥️📱

<div align="center">
  <img src="images/logo.jpg" alt="4 Eyes Logo" width="300" />
</div>

4 Eyes is a real-time web application that turns your phone into a smart AI camera. 
Stream your phone's camera feed directly to your computer browser using WebRTC, and use the Google Gemini Vision API to instantly analyze what the camera sees. The AI will even read its answers out loud to you!

## Features 🚀

- **Peer-to-Peer Video Streaming:** Uses WebRTC to stream ultra-low latency video from your phone to your desktop.
- **AI Vision Analysis:** Integrates with the Google Gemini API (`gemini-flash-latest`) to understand and solve problems shown to the camera (e.g., math equations, identifying objects).
- **Text-to-Speech:** Automatically reads the AI's response aloud.
- **Premium Glassmorphism UI:** Beautiful dark mode design with responsive layouts and smooth animations.
- **Spacebar Shortcut:** Just hit spacebar on your computer to trigger an AI analysis instantly!

## Prerequisites 🛠️

- **Java 21**
- **Maven**
- **Google Gemini API Key:** You can get a free one at [Google AI Studio](https://aistudio.google.com/).

## Getting Started 🏁

### 1. Configure your API Key
Open `src/main/resources/application.yml` and replace `{YOUR-API-KEY}` with your actual Gemini API key.
```yaml
gemini:
  api-key: {YOUR-API-KEY}
  model: gemini-flash-latest
```

### 2. Run the Application
Run the Spring Boot application using Maven:
```bash
./mvnw spring-boot:run
```

### 3. Connect your Devices
Since the app uses `getUserMedia()` to access your phone's camera, it **requires HTTPS**. The app is configured to run on `https://0.0.0.0:8443` using a self-signed certificate for local development.

1. **On your computer:** Open `https://localhost:8443` in your browser. Accept the self-signed certificate warning.
2. You will be given a **6-character Room Code**.
3. **On your phone:** Connect to the same WiFi network. Open `https://<YOUR_COMPUTER_LOCAL_IP>:8443` on your phone's browser.
4. Enter the Room Code on your phone and tap **Join as Camera**.
5. Your phone will start streaming to your computer!

## Usage 💡
- **Analyze:** Click the **Analyze** button (or press `Spacebar`) on your computer to send the current video frame to Gemini.
- **Custom Prompts:** Type a specific question (e.g., "Solve this math problem") in the text box before analyzing.
- **Flip Camera:** Use the controls on your phone to switch between the front and rear cameras.

## License
MIT License
