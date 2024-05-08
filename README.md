# Peer-to-peer WebRTC text chat

> This is an example app for my article: ["WebRTC guide"](https://www.sctheblog.com/blog/webrtc-intro/).

This is a small web app that uses [Web Real-Time Communication](https://en.wikipedia.org/wiki/WebRTC) (`WebRTC`) for between-browser [peer-to-peer](https://en.wikipedia.org/wiki/Peer-to-peer) (`p2p`) communication. The biggest problem when using a webpage for p2p is finding the communication channel. How can device A know the IP of the device B? This is resolved using the [Interactive Connectivity Establishment](https://en.wikipedia.org/wiki/Interactive_Connectivity_Establishment) (`ICE`) protocol. It generates a few connection candidates (e.g. inside a local network, through public IP, or an intermediary TURN server). Then it selects one to facilitate message exchange.

![Chat between 3 users](gh-images/webrtc-text-chat.png?raw=true)

It uses [Express](https://expressjs.com/) and [Socket.IO](https://socket.io/) (needed for ICE negotiation, see FAQ below) under the hood. No public demo, as it would be hard for me to [deploy it for free](https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections) while keeping it simple (no firebase, pusher, ably etc.).

## Usage

1. `yarn install`
1. `yarn start` <- dev server
1. Go to `http://localhost:3000` to open the chat room with a random `roomId` assigned
1. Use the link given by the first chat to join the existing chat room e.g. `http://localhost:3000?roomId=aUa62LD8NZ`

### Peer-to-peer testing procedure

Here is a testing procedure between a desktop browser and a mobile phone (disconnected from the local network):

**Running server**

1. `yarn start` <- dev server
2. `npm install -g localtunnel` <- install [localtunnel](https://theboroer.github.io/localtunnel-www/) to make our local server visible from other networks
3. `lt --port 3000` <- expose app to the internet
4. Go to `localtunnel`-generated url to make sure it works OK. You might need to provide your external IP as per `localtunnel` TOS.
5. Get the share link to the current chat room e.g. `https://a-b-c.loca.lt?roomId=aUa62LD8NZ`

**Connecting from a mobile device**

1. Disconnect from the local network (Wi-Fi etc.). Disconnect the phone from the PC.
2. Connect the phone to a mobile network (e.g. LTE) using your mobile carrier.
3. Open the chat url e.g. `https://a-b-c.loca.lt?roomId=aUa62LD8NZ`.
4. You might need to provide the same IP as in the "Running server" section. Again, `localtunnel` TOS to prevent spammers.
5. The app should connect to the chat room without any problems. After ICE resolves, you can exchange messages peer-to-peer.

If there is an error when connecting peer-to-peer, it is probably caused by a lack of a TURN server. I only use `stun:openrelay.metered.ca:80`, `stun:stun.l.google.com:19302` STUN servers. It's not hard to add another entry to [ICE_SERVERS](public/index.js#L148). It's just that free TURN servers are either crap or require login.

## How does this project work?

There are 2 parts to this project: an [express server](src/app.js) and a [simple webpage](public/index.html) with corresponding [index.js](public/index.js).

**Express server**

- Hosts the static content from `/public` (`.html`, `.js` files).
- Uses `socket.io` to facilitate socket connection to the client's browser. This is needed for WebRTC ICE candidate selection. The messages inside the chat room (after peer-to-peer connection is established) do not use sockets.

**Browser client**

- [Simple HTML](public/index.html) page. Uses CDN for `normalize.css`, and `socket.io`. 230 lines of `<style>` tag :)
- [index.js](public/index.js) as a main JS script.
  1. Establishes socket connection to the server.
  2. Joins/creates a new chat room.
  3. On every new connection (received by socket message), try to establish a peer-to-peer connection with the new user.

A lot of the code in the [client's index.js](public/index.js) is just formatting messages and UI updates. While ICE itself is implemented by the browser, we still have to write some code to cover all the cases. E.g. "user disconnected" message can happen when:

- we receive info from the socket server (broadcasted to the entire chat room when other user's socket disconnects),
- the peer-to-peer connection [changes status](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionstatechange_event) to `disconnected` (rarely happens in practice for some reason),
- the peer-to-peer [data channel is closed](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/close_event).

## FAQ

### I see some sockets? Is it really p2p?

Sockets are required to exchange data between peers **before** the p2p connection is established. Think about it: you have 2 random devices that try to connect over the internet. How does one know the IP of the other? The p2p connection conditions negotiation is the purpose of the ICE protocol.

Once the ICE chooses a candidate, we can start sending the messages bypassing the server - p2p only. Check the network tab in the browser.

### How can I debug this app?

Everything is printed to the console. Both on the client and server. Every message, state change etc. It's a lot, but if you are only doing one ICE at a time, it's quite straightforward.

### How does tunneling work with sockets?

It does not. Socket.io can use the basic socket implementation: long-polling. Upgrade to sockets is skipped/fails.

## References

- https://bloggeek.me/webrtcglossary/stun/
- https://webrtc.github.io/samples/
- https://www.stackfive.io/work/webrtc/the-beginners-guide-to-understanding-webrtc
