const dgram = require('dgram');
const db = require('./db');

const UDP_PORT = 8001;
const BROADCAST_ADDR = '255.255.255.255';

function startDiscoveryService(httpPort) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[INFO] UDP Discovery port ${UDP_PORT} is already bound by an existing instance.`);
    } else {
      console.warn(`Discovery UDP notice: ${err.message}`);
    }
  });

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text === 'COTHI_DISCOVER' || text.startsWith('COTHI_PING')) {
      const settings = db.getSettings();
      const response = JSON.stringify({
        type: 'COTHI_OFFLINE_SERVER',
        httpPort: httpPort,
        school: {
          name: settings.schoolName,
          motto: settings.schoolMotto,
          code: settings.schoolCode,
          logo: settings.schoolLogo,
          primaryColor: settings.primaryColor,
          accentColor: settings.accentColor
        }
      });

      socket.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
        if (!err) {
          console.log(`[AUTO-DISCOVERY] Responded to student terminal at ${rinfo.address}:${rinfo.port}`);
        }
      });
    }
  });

  socket.bind(UDP_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[AUTO-DISCOVERY] LAN Auto-Discovery beacon active on UDP port ${UDP_PORT}`);

    // Broadcast announcement every 4 seconds to the entire Wi-Fi LAN
    setInterval(() => {
      try {
        const settings = db.getSettings();
        const beacon = JSON.stringify({
          type: 'COTHI_BEACON',
          httpPort: httpPort,
          school: {
            name: settings.schoolName,
            motto: settings.schoolMotto,
            code: settings.schoolCode,
            logo: settings.schoolLogo,
            primaryColor: settings.primaryColor,
            accentColor: settings.accentColor
          }
        });
        socket.send(beacon, 0, beacon.length, UDP_PORT, BROADCAST_ADDR, () => {});
      } catch (e) {}
    }, 4000);
  });
}

module.exports = { startDiscoveryService };
