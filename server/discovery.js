const dgram = require('dgram');
const os = require('os');
const db = require('./db');

const UDP_PORT = 8001;
const BROADCAST_ADDR = '255.255.255.255';

function getAllBroadcastAddrs() {
  const addrs = new Set([BROADCAST_ADDR, '127.0.0.1']);
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            addrs.add(parts.slice(0, 3).join('.') + '.255');
          }
        }
      }
    }
  } catch (e) {}
  return Array.from(addrs);
}

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
    try { socket.setBroadcast(true); } catch (e) {}
    console.log(`[AUTO-DISCOVERY] LAN Auto-Discovery beacon active on UDP port ${UDP_PORT}`);

    // Broadcast announcement every 3 seconds to all subnets & 255.255.255.255
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
        const targets = getAllBroadcastAddrs();
        targets.forEach(tgt => {
          socket.send(beacon, 0, beacon.length, UDP_PORT, tgt, () => {});
        });
      } catch (e) {}
    }, 3000);
  });
}

module.exports = { startDiscoveryService };
