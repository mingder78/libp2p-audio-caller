import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { multiaddr } from '@multiformats/multiaddr';
import { identify } from '@libp2p/identify';

async function main() {
  const libp2p = await createLibp2p({
    transports: [tcp(), circuitRelayTransport()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify()
    }
  });

  const remotePeerId = '12D3KooWLCffBZEDJzpzf6UgK8eCxLkRLHpBui9UZSYSha46kFSF'; // Target PeerID
  const relayMaStr = '/ip4/127.0.0.1/tcp/9001/p2p/12D3KooWQW6znUCXWpgLPUf9TXYo7ER1VYvvb2b9jzfJux8Zmj2H'; // Relay PeerID

  try {
    // Build the circuit multiaddr
    const circuitAddr = `${relayMaStr}/p2p-circuit/p2p/${remotePeerId}`;
    console.log('Dialing via circuit:', circuitAddr);
    const ma = multiaddr(circuitAddr);

    // ✅ Dial via a protocol stream (required for circuit relay in v2)
    const { stream } = await libp2p.dialProtocol(ma, '/libp2p/circuit/relay/1.0.0');

    console.log('Connected to remote peer via relay!');
    // Optionally, read/write from stream here
  } catch (err) {
    console.error('Dial failed:', err);
  }
}

main().catch(console.error);

