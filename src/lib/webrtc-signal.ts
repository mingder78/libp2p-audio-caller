// src/lib/webrtc-signal.ts

import { createLibp2p } from 'libp2p'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { multiaddr } from '@multiformats/multiaddr';

export const AUDIO_PROTOCOL = '/webrtc-audio/1.0.0'

export async function createNode() {
    return await createLibp2p({
        addresses: {
            listen: ['/webrtc', '/p2p-circuit', '/p2p-circuit/webrtc'] // Listen for relayed WebRTC
        },
        transports: [
            webRTC({
                rtcConfiguration: {
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // STUN for NAT
                }
            }),
            webSockets(),
            circuitRelayTransport()
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
            identify: identify(),
            relay: circuitRelayServer({
                reservations: {  // Configures reservation limits (default: unlimited for testing)
                    maxReservations: 50,  // Max concurrent reservations
                    maxReservationsPerPeer: 10,  // Per client
                    reservationDuration: 300000,  // 5 minutes in ms (renewable)
                    reservationTTL: 600000  // Total lifetime
                },
                connections: {  // Limits relayed connections
                    maxIncoming: 100,
                    maxOutgoing: 100,
                    maxPerPeer: 5
                },
                // ACL: undefined  // No ACL = accepts reservations from any peer (key for "true" reservations)
                // For production: ACL: { allow: ['QmSpecificPeerID'] } to restrict
                metrics: { enabled: true }  // Optional: Enable Prometheus metrics
            })
        }
    })
}

export async function registerSignaling(node: any, pc: RTCPeerConnection) {
console.log('----------------- registerSignaling')
    node.handle(AUDIO_PROTOCOL, async ({ stream }) => {
        const decoder = new TextDecoder()
        const reader = stream.getReader()
console.log(stream)
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const msg = JSON.parse(decoder.decode(value))
            console.log('-----📩 signaling msg', msg)

            if (msg.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(msg))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await sendSignal(node, msg.from, pc.localDescription)
            } else if (msg.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(msg))
            } else if (msg.candidate) {
                await pc.addIceCandidate(msg)
            }
        }
    })
}

export async function sendSignal(node: any, peerId: string, data: any) {
    console.log('peerID', peerId)
    console.log('data', data)
    await node.dialProtocol(multiaddr(peerId), AUDIO_PROTOCOL)
}

export async function setupPeerConnection(node: any) {
    const pc = new RTCPeerConnection()

    // remote audio playback
    const audioEl = document.createElement('audio')
    audioEl.autoplay = true
    pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0]
    }
    document.body.appendChild(audioEl)

    // local microphone
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    // ICE candidates → send via libp2p
    pc.onicecandidate = async (event) => {
        if (event.candidate && remotePeerId) {
            await sendSignal(node, remotePeerId, event.candidate.toJSON())
        }
    }

    await registerSignaling(node, pc)
    return pc
}
