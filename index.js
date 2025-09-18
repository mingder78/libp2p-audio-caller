import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
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

  const remotePeerId = '12D3KooWLCffBZEDJzpzf6UgK8eCxLkRLHpBui9UZSYSha46kFSF'; // Replace with actual PeerID
  const relayMaStr = '/ip4/127.0.0.1/tcp/9001/p2p/12D3KooWQW6znUCXWpgLPUf9TXYo7ER1VYvvb2b9jzfJux8Zmj2H'; // Replace with relay PeerID

  try {
    // Dial via relay
    const circuitAddr = `${relayMaStr}/p2p-circuit/p2p/${remotePeerId}`;
    console.log('Dialing via circuit:', circuitAddr);
    const ma = multiaddr(circuitAddr);

// modern PeerId (CIDv1 base32)
const peerId = peerIdFromString(remotePeerId)
    await libp2p.dial({ id: peerId, multiaddrs: [ma]});
    console.log('Connected to remote peer!');
  } catch (err) {
    console.error('Dial failed:', err);
  }
}

main().catch(console.error);
