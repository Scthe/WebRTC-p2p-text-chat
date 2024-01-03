/////////////////////////////
// WebRTC related

// TODO normalizer.css

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:openrelay.metered.ca:80",
    },
  ],
};

const createPeerConnection = (peerUserId, handleICECandidate) => {
  const connection = new RTCPeerConnection(ICE_SERVERS);
  connection.peerUserId = peerUserId;
  connection.onicecandidate = handleICECandidate;

  return connection;
};

async function createPeerOffer(peerConnection) {
  try {
    // offer-side creates the data channel
    const channel = peerConnection.createDataChannel("my-rtc-chat");
    peerConnection.myRtcChatChannel = channel;

    channel.onopen = (_event) => {
      channel.send(
        "Hi! You have established peer-to-peer connection with me! Other users will also send you this message once they have their own connection!",
      );
    };
    channel.onmessage = printUserMessage(peerConnection);

    // create offer
    const offer = await peerConnection.createOffer();
    peerConnection.setLocalDescription(offer);
    logPeer("[OFFER]", offer);
    return offer;
  } catch (error) {
    logPeer("[OFFER Error]", error);
    throw error;
  }
}

async function createPeerAnswer(peerConnection) {
  try {
    // answer-side will receive 'new data channel' event
    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      peerConnection.myRtcChatChannel = channel;

      channel.onopen = (_event) => {
        channel.send("Hi I am new to this chat room!");
      };
      channel.onmessage = printUserMessage(peerConnection);
    };

    // create answer
    const answer = await peerConnection.createAnswer();
    peerConnection.setLocalDescription(answer);
    logPeer("[ANSWER]", answer);
    return answer;
  } catch (error) {
    logPeer("[ANSWER Error]", error);
    throw error;
  }
}

/////////////////////////////
// Socket related

const createSocketConnection = () => {
  // const socket = io(`ws://${window.location.host}:3005`);
  const socket = io();
  socket.onAny((...args) => {
    const [name, ...args2] = args;
    logSocket(`Received '${name}', args`, ...args2);
  });

  socket.on("disconnect", () => {
    // TODO handle
  });

  return socket;
};

function createChatRoom() {
  console.log(`Create new chat room`);

  const socket = createSocketConnection();
  socket.on("room-created", (roomId) => {
    // TODO create link in ui!
    // console.log({ roomId });
  });
  socket.emit("create-room");
  return socket;
}

function getRoomIdFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const roomId = searchParams.get("roomId");
  const isValidRoomId =
    roomId && typeof roomId === "string" && roomId.length > 3;
  return isValidRoomId ? roomId : undefined;
}

function joinChatRoom(roomId) {
  console.log(`Joining room '${roomId}'`);

  const socket = createSocketConnection();
  socket.emit("join-room", roomId);
  return socket;
}

/////////////////////////////
// main

let userName = undefined;

const peerConnections = {};
const getPeerConnection = (userId) => {
  const peerConnection = peerConnections[userId];
  if (!peerConnection) {
    throw new Error(
      `Unexpected message from '${userId}', we never tried to connect to it?`,
    );
  }
  return peerConnection;
};

(async function main() {
  initializeUi();

  const roomId = getRoomIdFromUrl();
  const socket = roomId ? joinChatRoom(roomId) : createChatRoom();
  userName = socket.id;

  const createICECandidateHandler = (peerUserId) => (event) => {
    logPeer(`Created ICE candidate to '${peerUserId}:'`, event);

    if (event.candidate) {
      socket.emit("ice-candidate", peerUserId, event.candidate);
    }
  };

  socket.on("new-user-joined", async (newUserId) => {
    const handleICECandidate = createICECandidateHandler(newUserId);
    const peerConnection = createPeerConnection(newUserId, handleICECandidate);
    peerConnections[newUserId] = peerConnection;

    const offer = await createPeerOffer(peerConnection);
    socket.emit("rtc-offer", newUserId, offer);
  });

  socket.on("rtc-offer", async (offerUserId, offer) => {
    const handleICECandidate = createICECandidateHandler(offerUserId);
    const peerConnection = createPeerConnection(
      offerUserId,
      handleICECandidate,
    );
    peerConnection.setRemoteDescription(offer);
    peerConnections[offerUserId] = peerConnection;

    const answer = await createPeerAnswer(peerConnection);
    socket.emit("rtc-answer", offerUserId, answer);
  });

  socket.on("rtc-answer", async (answerUserId, answer) => {
    const peerConnection = getPeerConnection(answerUserId);
    peerConnection.setRemoteDescription(answer);
  });

  socket.on("ice-candidate", async (peerUserId, candidate) => {
    const peerConnection = getPeerConnection(peerUserId);
    await peerConnection.addIceCandidate(candidate);
  });
})();

function logSocket(...args) {
  console.log("[Socket]", ...args);
}

// TODO attach to RTC object: peerConnection.logPeer
function logPeer(...args) {
  console.log("[WebRTC]", ...args);
}

/////////////////////////////
// ui

function sendToAllPeers(message) {
  if (!message) {
    return false;
  }

  Object.values(peerConnections).forEach((peerConnection) => {
    const channel = peerConnection.myRtcChatChannel;
    if (channel) {
      channel.send(message);
    }
  });

  addLogLine("ME:", message);
}

function initializeUi() {
  const form = document.getElementById("form");
  const input = document.getElementById("input");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const message = input.value;
    if (!message) {
      return;
    }

    sendToAllPeers(message);
    input.value = "";
  });
}

const printUserMessage = (peerConnection) => (message) => {
  const username = peerConnection.peerUserId;
  logPeer("Received", message);
  addLogLine(username, message.data || "");
};

/*const LOG_ENTITY = {
  Socket: 1,
  Rtc: 2,
};*/

function addLogLine(username, message) {
  // TODO color per user
  // TODO after creating room, set own query param? can be through the #-param instead of query-param. Or local storage
  // TODO add disconnect button
  // TODO auto scroll?
  // TODO put the input at the bottom, next to the disconnect button?
  // TODO show system messages to the user too. Not full js objects, just the texts. Add 'msg-system' class and grey it out a bit
  /*
  const classNames = [];
  if (username == LOG_ENTITY.Socket) {
    classNames.push("log-socket");
    username = "[SocketServer]";
  } else if (username == LOG_ENTITY.Rtc) {
    classNames.push("log-rtc");
    username = "[WebRTC]";
  }*/

  const usernameEl = document.createElement("span");
  usernameEl.textContent = username;
  usernameEl.className = "msg-username";
  const messageEl = document.createElement("span");
  messageEl.textContent = message;

  const itemEl = document.createElement("li");
  itemEl.appendChild(usernameEl);
  itemEl.appendChild(messageEl);
  // TBH not needed, 'id' atttribute creates a global variable. Would be even faster that way (cached)
  const messages = document.getElementById("messages");
  messages.appendChild(itemEl);
}
