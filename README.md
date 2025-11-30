# Simple Home Assistant Dashboard (SHAD)

![SHAD Screenshot](https://github.com/koksny/shad/blob/main/shad_screenshot.jpg)
![SHAD In-Use](https://github.com/koksny/shad/blob/main/shad_production.jpg)

A lightweight, modular dashboard for embedded and IoT devices. SHAD displays widgets like time, weather, local sensor data, calendar events, and background camera feeds from up to 18 cameras. Optimized for lower power ARM devices such as Raspberry Pi 4, you can run 4 camera feeds at around 50% CPU utilization.

Essentially a weather station/clock with background camera feeds for any device capable of running Chromium, or other lightweight browsers with video decoding.

## Version 1.1 - What's New

### 🏗️ Major Architecture Refactor
- **Modular ES6 Architecture**: Complete rewrite from single monolithic HTML to a clean, modular JavaScript architecture with ES6 modules.
- **Service-Based Design**: Separated concerns into dedicated services:
  - `ConfigManager.js` - Central configuration and state management
  - `CameraManager.js` - HLS camera stream handling with health monitoring
  - `WeatherService.js` - Weather data fetching and city search
  - `SensorService.js` - Temperature/humidity sensor polling
  - `CalendarService.js` - Calendar events and banner display
  - `WidgetManager.js` - Widget positioning, resizing, and visibility
  - `helpers.js` - Utility functions (throttle, debounce, formatting)

### 🎨 New Features
- **Multiple Themes**: Choose between Dark, Cats, and Space themes with unique color schemes and fonts.
- **Calendar Event Banner**: Display scrolling event messages for specific dates with sliding animation.
- **HD Mode**: New `?dashboard=0` URL parameter for camera-only display on powerful devices.
- **Improved Camera Health Monitoring**: Auto-recovery for stalled/frozen camera feeds every 5 seconds.
- **Sequential Camera Loading**: Staggered initialization for kiosk mode to prevent overwhelming low-power devices.
- **Page Visibility Handling**: All services pause when tab is hidden, resume on visibility (saves resources).

### 🐛 Bug Fixes & Improvements
- **Memory Leak Prevention**: Proper cleanup of HLS instances, event listeners, and abort controllers.
- **Camera Stream Stability**: Live sync positioning, cache-busting for manifests, and exponential backoff retries.
- **Rate Limiting**: Weather API calls now rate-limited to prevent excessive requests.
- **XSS Prevention**: HTML escaping for user-provided content (city names, calendar messages).
- **Improved Error Handling**: AbortController support for cancelable fetch requests across all services.
- **Widget Boundary Enforcement**: Widgets stay within viewport bounds when dragging/resizing.
- **Font Scaling**: Automatic font size adjustment based on widget dimensions.

### 📁 New File Structure
```
src/
├── index.html
├── config/
│   ├── calendar.json         # Calendar events
│   └── shad_default1.conf    # Configuration presets
├── css/
│   └── styles.css            # All styles with theme support
├── js/
│   ├── main.js               # Application entry point
│   ├── ConfigManager.js      # Central configuration
│   ├── services/
│   │   ├── CalendarService.js
│   │   ├── CameraManager.js
│   │   ├── SensorService.js
│   │   └── WeatherService.js
│   ├── utils/
│   │   └── helpers.js
│   └── widgets/
│       └── WidgetManager.js
└── scripts/
    ├── kiosk.sh
    └── readSensor.sh
```

## Features

- **Lightweight & Modular**: Clean ES6 module architecture, easy to extend.
- **Easy Setup**: Just copy the `src/` folder to any HTTP server.
- **Customizable Widgets**:
  - Time and Date (EU format by default).
  - Weather with 4-day forecast (updates every 15 minutes).
  - Temperature and Humidity sensors.
  - Up to 18 camera feeds in HLS format (.m3u8).
  - Calendar event banner with date-based messages.
- **Configurable**:
  - Save up to 10 different configuration presets.
  - Widgets can be toggled, moved, and resized via drag-and-drop.
  - Background opacity and blur adjustments.
  - Multiple color themes (Dark, Cats, Space).
- **Two Display Modes**:
  - **Kiosk Mode** (`?dashboard=1`): Full dashboard with widgets (default).
  - **HD Mode** (`?dashboard=0`): Camera-only display for high-power devices.
- **Robust Camera Handling**: Health monitoring, auto-recovery, and staggered loading.

## Table of Contents

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Configuration](#configuration)
  - [Creating Configuration Files](#creating-configuration-files)
  - [Switching Configurations](#switching-configurations)
  - [Calendar Events](#calendar-events)
- [Usage](#usage)
  - [Camera Feeds](#camera-feeds)
  - [Sensor Widgets](#sensor-widgets)
  - [Weather Widget](#weather-widget)
  - [Display Modes](#display-modes)
- [Themes](#themes)
- [Kiosk Mode](#kiosk-mode)
- [Extras](#extras)
- [Debugging](#debugging)
- [Credits](#credits)
- [License](#license)

## Getting Started

### Prerequisites

- An HTTP server (e.g., Apache, NGINX)
- Any modern web browser on client terminal
- Optional: Raspberry Pi 4 or similar ARM device for low-power setups
- Optional: [Restreamer](https://datarhei.github.io/restreamer/) for camera feeds
- Optional: `wtype` utility for kiosk mode

### Installation

1. **Download SHAD**

   Clone or download the repository to your local machine:

   ```bash
   git clone https://github.com/koksny/SHAD.git
   ```

2. **Set Up HTTP Server**

   Copy the `src/` folder contents to the root directory of your HTTP server.

   ```bash
   cp -r SHAD/src/* /var/www/html/
   ```

3. **Access the Dashboard**

   Open your web browser and navigate to your server's address:

   ```
   http://yourserveraddress/index.html
   ```

## Configuration

### Creating Configuration Files

1. **Open Settings**

   Open SHAD in your browser and click the ⚙️ settings button.

2. **Customize Dashboard**

   - Toggle widgets on or off.
   - Move and resize widgets by dragging.
   - Adjust theme, opacity, blur, and font sizes.

3. **Export Configuration**

   At the bottom of the Settings panel, click on **Export Configuration**.

4. **Save Configuration**

   - A JSON file will be downloaded.
   - Rename it to `shad_default1.conf`.

5. **Deploy Configuration**

   Place the renamed configuration file in the `config/` directory.

   ```bash
   cp shad_default1.conf /var/www/html/config/
   ```

### Switching Configurations

- **Store Multiple Presets**

  You can store up to 10 presets, named `shad_default0.conf` to `shad_default9.conf` in the `config/` folder.

- **Switch via Keyboard**

  Press keys `0`-`9` to switch between configurations.

- **Switch via URL**

  Add `?config=N` to your URL to load a specific configuration.

  ```
  http://yourserveraddress/index.html?config=3
  ```

### Calendar Events

Calendar events display as a scrolling banner at the bottom of the screen.

1. **Create Events via Settings**
   - Navigate to Calendar Management in Settings.
   - Select a date and enter a message.
   - Click "Save Event".

2. **Edit `calendar.json` Directly**
   
   Place a `calendar.json` file in the `config/` directory:

   ```json
   {
     "2024-12-25": "Merry Christmas! 🎄",
     "2024-12-31": "Happy New Year! 🎉"
   }
   ```

3. **Export Calendar**
   
   Use the "Export Calendar" button in Settings to download your events.

## Usage

### Camera Feeds

- **Supported Formats**: HLS (`.m3u8` links preferred), RTSP (limited browser support).
- **Recommendation**:

  Use [Restreamer](https://datarhei.github.io/restreamer/) to convert RTSP to HLS.

- **Optimization**:

  Reduce bitrate, resolution, and framerate for low-power devices.

- **Auto-Recovery**:

  Cameras are monitored every 5 seconds. Stalled feeds are automatically restarted.

### Sensor Widgets

- **Supported Sensors**: Temperature and Humidity from GPIO or Bluetooth devices.
- **Data Feeding**:

  Save sensor data to `sensor1.txt` or `sensor2.txt` in the root directory.

  - Format: `T:xx.x|M:xx`
  - Example: `T:23.5|M:45` (Temperature: 23.5°C, Humidity: 45%)

- **Update Intervals**:

  Configure refresh intervals (in seconds) in the Settings panel.

- **Note**:

  SHAD does **not** provide a backend for sensor data. You must handle updating the sensor `.txt` files yourself.

### Weather Widget

- **Automatic Updates**:

  The weather widget updates every 15 minutes using the Open-Meteo API.

- **City Search**:

  Type a city name (minimum 3 characters) to see suggestions.

- **Data Displayed**:
  - Current temperature and weather icon
  - Wind speed and gusts
  - Pressure and humidity
  - 4-day forecast

### Display Modes

SHAD supports two display modes via the `dashboard` URL parameter:

- **Kiosk Mode** (default): `?dashboard=1`
  - Shows all widgets and UI elements.
  - Cameras load sequentially (better for Raspberry Pi).

- **HD Mode**: `?dashboard=0`
  - Camera-only display, no widgets.
  - Cameras load simultaneously (for powerful devices).
  - Calendar banner is hidden.

Example: `http://yourserver/index.html?config=1&dashboard=0`

## Themes

SHAD includes three built-in themes:

| Theme | Description | Font |
|-------|-------------|------|
| **Dark** | Default dark mode with blue accents | Inter |
| **Cats** | Purple/pink theme with warm accents | Quicksand |
| **Space** | Deep purple theme with cosmic vibes | Space Grotesk |

Change themes in the Settings panel under "Theme".

## Kiosk Mode

To run SHAD as a kiosk on a Raspberry Pi:

1. **Edit `kiosk.sh`**

   - Open `scripts/kiosk.sh` in a text editor.
   - Change the SHAD server address to your server.

2. **Make Executable**

   ```bash
   chmod +x scripts/kiosk.sh
   ```

3. **Add to Autostart**

   - Add `kiosk.sh` to your autostart script or crontab.

4. **Dependencies**

   Ensure `wtype` is installed for automatic page reload:

   ```bash
   sudo apt install wtype
   ```

5. **Customization**

   If the reload issue doesn't occur on your setup, you can remove the `sleep` and `wtype` commands from `kiosk.sh`.

## Extras

### Using Xiaomi Bluetooth Thermometer (LYWSD03MMC)

If you're using the $4 Xiaomi Bluetooth thermometer:

1. **Edit `readSensor.sh`**

   - Change the Bluetooth MAC address to match your device.

2. **Set Up Cron Job**

   ```bash
   crontab -e
   ```

   Add a line like:

   ```bash
   */5 * * * * /path/to/scripts/readSensor.sh
   ```

   This runs the script every 5 minutes.

## Debugging

SHAD includes built-in health status for debugging. Open the browser console and run:

```javascript
configManager.getHealthStatus()
```

This returns the status of all services including:
- Camera health (playing, stalled, retry count)
- Weather service status
- Sensor polling status
- Widget states

## Credits

- **Author**: [Koksny](https://github.com/koksny)
- **Built With**: [Websim.ai](https://websim.ai) - Thanks to the Websim team for providing such a great development tool.
- **Weather Data**: [Open-Meteo](https://open-meteo.com/) - Free weather API.
- **Libraries**:
  - [HLS.js](https://github.com/video-dev/hls.js/) - HTTP Live Streaming in JavaScript.
  - [interact.js](https://interactjs.io/) - Drag and resize functionality.

## License

This project is licensed under the [MIT License](./LICENSE).
