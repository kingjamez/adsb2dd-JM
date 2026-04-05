# adsb2dd (bare-metal)

Lightweight API server that converts ADS-B aircraft positions into bistatic delay-Doppler coordinates for passive radar systems like [blah2](https://github.com/30hours/blah2).

Fork of [30hours/adsb2dd](https://github.com/30hours/adsb2dd) — stripped to API-only (no web frontend), deployed without Docker.

For Docker deployment, see the `main` branch.

## Features

- Converts ADS-B data from a [tar1090](https://github.com/wiedehopf/tar1090) server to delay-Doppler coordinates given receiver/transmitter positions and radar center frequency.
- JSON output with bistatic delay (km) and Doppler (Hz) per aircraft.
- Smoothed Doppler via moving median filter (k=10 samples).
- Supports multiple simultaneous receiver/transmitter geometries.
- Health check endpoint at `/api/status`.
- Runs as a systemd service with auto-restart.

## Installation

Requires [Node.js](https://nodejs.org/) 16+.

```bash
git clone -b bare-metal https://github.com/kingjamez/adsb2dd-JM.git /opt/adsb2dd-JM
cd /opt/adsb2dd-JM
sudo ./install.sh
```

This installs npm dependencies, sets up a systemd service, and starts adsb2dd on port 3000.

### Manual Start (without systemd)

```bash
./start.sh         # default port 3000
./start.sh 8080    # custom port
```

### Service Management

```bash
sudo systemctl status adsb2dd
sudo systemctl restart adsb2dd
journalctl -u adsb2dd -f
```

## API

### GET /api/dd

Returns delay-Doppler coordinates for all tracked aircraft.

**Parameters:**
- `rx` — receiver lat,lon,alt (e.g. `38.877,-77.399,50`)
- `tx` — transmitter lat,lon,alt (e.g. `38.999,-77.057,750`)
- `fc` — center frequency in MHz (e.g. `101.1`)
- `server` — tar1090 URL (e.g. `http://192.168.1.10/tar1090`)

**Example:**
```
GET /api/dd?rx=38.877,-77.399,50&tx=38.999,-77.057,750&fc=101.1&server=http://192.168.1.10/tar1090
```

**Response:**
```json
{
  "a86ab5": {
    "timestamp": 1700000000,
    "flight": "UAL947",
    "delay": 12.345,
    "doppler": -23.456
  }
}
```

The first call to a new set of parameters returns `{}` while the processing loop initializes. Subsequent calls return computed data.

### GET /api/status

Returns uptime, active configurations, and sample aircraft data.

## How It Works

- Fetches aircraft positions from tar1090's `/data/aircraft.json` endpoint every second.
- Converts lat/lon/alt to ECEF coordinates.
- Computes bistatic delay: `d(rx,target) + d(tx,target) - d(rx,tx)`.
- Computes bistatic Doppler as the smoothed rate-of-change of delay using a moving median filter.
- Inactive request sets are dropped after 30 seconds without an API call.

## License

[MIT](https://choosealicense.com/licenses/mit/)
