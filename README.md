# Simple Home Assistant Dashboard (SHAD)

![SHAD Screenshot](https://github.com/koksny/shad/blob/main/shad_screenshot.jpg)
![SHAD In-Use](https://github.com/koksny/shad/blob/main/shad_production.jpg)

A no-bloat, single `.html` file, no-installation or setup dashboard for embedded and IoT devices. SHAD displays widgets like time, weather, local sensor data, and background camera feeds from up to 20 cameras. Optimized for lower power ARM devices such as Raspberry Pi 4, you can run 4 camera feeds at around 50% CPU utilization.

Essentially a weather station/clock with background camera feeds for any device capable of running Chromium, or other lightweight browsers with video decoding. 

## Features

- **Lightweight**: Single `index.html` file, no installation required.
- **Easy Setup**: Just drop `index.html` into any HTTP server.
- **Customizable Widgets**:
  - Time and Date (EU format by default).
  - Weather updates every 15 minutes.
  - Temperature and Humidity sensors.
  - Up to 20 camera feeds in RTSP/HLS format.
- **Configurable**:
  - Save up to 10 different configuration presets.
  - Widgets can be toggled, moved, and resized.
  - Background opacity and blur adjustments.
- **Kiosk Mode**: Run as a kiosk on devices like Raspberry Pi.

## Table of Contents

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Configuration](#configuration)
  - [Creating Configuration Files](#creating-configuration-files)
  - [Switching Configurations](#switching-configurations)
- [Usage](#usage)
  - [Camera Feeds](#camera-feeds)
  - [Sensor Widgets](#sensor-widgets)
  - [Weather Widget](#weather-widget)
- [Kiosk Mode](#kiosk-mode)
- [Extras](#extras)
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

   Copy the `index.html` file to the root directory of your HTTP server.

   ```bash
   cp SHAD/index.html /var/www/html/
   ```

3. **Access the Dashboard**

   Open your web browser and navigate to your server's address:

   ```
   http://yourserveraddress/index.html
   ```

## Configuration

### Creating Configuration Files

1. **Open Settings**

   Open SHAD in your browser and navigate to the **Settings** tab.

2. **Customize Dashboard**

   - Toggle widgets on or off.
   - Move and resize widgets to your preference.
   - Adjust background opacity and blur.

3. **Export Configuration**

   At the bottom of the Settings tab, click on **Export Configuration**.

4. **Save Configuration**

   - A JSON file will be downloaded.
   - Rename it to `shad_default1.conf`.

5. **Deploy Configuration**

   Place the renamed configuration file in the root directory with `index.html`.

   ```bash
   cp shad_default1.conf /var/www/html/
   ```

### Switching Configurations

- **Store Multiple Presets**

  You can store up to 10 presets, named `shad_default0.conf` to `shad_default9.conf`.

- **Switch via Keyboard**

  Press keys `0`-`9` to switch between configurations.

- **Switch via URL**

  Add `?config=N` to your URL to load a specific configuration.

  ```
  http://yourserveraddress/index.html?config=3
  ```

## Usage

### Camera Feeds

- **Supported Formats**: RTSP/HLS (preferably `.m3u8` links).
- **Recommendation**:

  Use [Restreamer](https://datarhei.github.io/restreamer/) to stream multiple feeds efficiently.

- **Optimization**:

  Reduce bitrate, resolution, and framerate for low-power devices.

### Sensor Widgets

- **Supported Sensors**: Temperature and Humidity from GPIO or Bluetooth devices.
- **Data Feeding**:

  Save sensor data to `sensor1.txt` or `sensor2.txt` in the root directory.

  - Format: `T:xx|M:xx`
  - Example: `T:23|M:45` (Temperature: 23°C, Humidity: 45%)

- **Update Intervals**:

  Set intervals in the Settings tab.

- **Note**:

  SHAD does **not** provide a backend for sensor data. You must handle updating the sensor `.txt` files yourself.

### Weather Widget

- **Automatic Updates**:

  The weather widget updates every 15 minutes.

- **Customization**:

  Set your location in the Settings tab.

## Kiosk Mode

To run SHAD as a kiosk on a Raspberry Pi:

1. **Edit `kiosk.sh`**

   - Open `kiosk.sh` in a text editor.
   - Change the SHAD server address to your server.

2. **Make Executable**

   ```bash
   chmod +x kiosk.sh
   ```

3. **Add to Autostart**

   - Add `kiosk.sh` to your autostart script or crontab.

4. **Dependencies**

   Ensure `wtype` is installed. It's used to automatically press F5 after 30 seconds because Chromium sometimes requires a reload in kiosk mode for camera feeds to update smoothly.

   - Install `wtype`:

     ```bash
     sudo apt install wtype
     ```

5. **Customization**

   If the reload issue doesn't occur on your setup:

   - Remove the `sleep` and `wtype` commands from `kiosk.sh`.
   - Or set up your own browser kiosk autostart script.

## Extras

- **Using Xiaomi Bluetooth Thermometer**

  If you're using the $4 Xiaomi Bluetooth thermometer:

  1. **Edit `readSensor.sh`**

     - Change the Bluetooth MAC address to match your device.

  2. **Set Up Cron Job**

     - Use `crontab` to execute the script at your desired interval.

     ```bash
     crontab -e
     ```

     Add a line like:

     ```bash
     */5 * * * * /path/to/readSensor.sh
     ```

     This runs the script every 5 minutes.

## Credits

- **Author**: [Koksny](https://github.com/koksny)
- **Built With**: [Websim.ai](https://websim.ai) - Thanks to the Websim team for providing such a great development tool.

## License

This project is licensed under the [MIT License](./LICENSE).
