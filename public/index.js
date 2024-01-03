// TODO make disconnect button work
// TODO add initial screen to join/create room
// TODO format log messages
// TODO color per user
// TODO after creating room, set own query param? can be through the #-param instead of query-param. Or local storage
// TODO add disconnect button
// TODO auto scroll?
// TODO put the input at the bottom, next to the disconnect button?
// TODO show system messages to the user too. Not full js objects, just the texts. Add 'msg-system' class and grey it out a bit

/////////////////////////////
// PeerConnectionsRepo

/** Struct that holds references to all the connections */
class PeerConnectionsRepo {
  constructor() {
    this.connections = {};
  }

  addConnection(peerId, peerConnection) {
    this.deleteConnection(peerId);
    this.connections[peerId] = {
      peerId,
      connection: peerConnection,
      color: getRandomColor(), // "#00dbff",
      channel: undefined,
    };
    this._updateUserCount();
  }

  hasConnection(peerId) {
    return Boolean(this.connections[peerId]);
  }

  getConnection(peerId) {
    const peerConnection = this.connections[peerId];
    if (!peerConnection) {
      throw new Error(
        `Unexpected message from '${peerId}', we never tried to connect to it?`,
      );
    }
    return peerConnection;
  }

  deleteConnection(peerId) {
    delete this.connections[peerId];
    this._updateUserCount();
  }

  setChannel(peerId, channel) {
    const peerConnection = this.getConnection(peerId);
    peerConnection.channel = channel;
  }

  sendToAllPeers(message) {
    if (!message) {
      return;
    }

    Object.values(this.connections).forEach((connection) => {
      const channel = connection.channel;
      if (channel) {
        channel.send(message);
      }
    });
  }

  _updateUserCount() {
    const len = Object.values(this.connections).length;
    updateUserCountEl(len + 1);
  }
}

const peerConnectionsRepo = new PeerConnectionsRepo();

/////////////////////////////
// WebRTC related

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:openrelay.metered.ca:80",
    },
  ],
};

const createPeerConnection = (handleICECandidate) => {
  const connection = new RTCPeerConnection(ICE_SERVERS);
  connection.onicecandidate = handleICECandidate;
  return connection;
};

async function createPeerOffer(peerId, peerConnection) {
  try {
    // offer-side creates the data channel
    const channel = peerConnection.createDataChannel("my-rtc-chat");
    peerConnectionsRepo.setChannel(peerId, channel);
    channel.onopen = (_event) => {
      channel.send(
        "Hi! You have established peer-to-peer connection with me! Other users will also send you this message once they have their own connection!",
      );
    };
    channel.onmessage = printUserMessage(peerId);

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

async function createPeerAnswer(peerId, peerConnection) {
  try {
    // answer-side will receive 'new data channel' event
    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      peerConnectionsRepo.setChannel(peerId, channel);

      channel.onopen = (_event) => {
        channel.send("Hi I am new to this chat room!");
      };
      channel.onmessage = printUserMessage(peerId);
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
    const peerConnection = createPeerConnection(handleICECandidate);
    peerConnectionsRepo.addConnection(newUserId, peerConnection);

    const offer = await createPeerOffer(newUserId, peerConnection);
    socket.emit("rtc-offer", newUserId, offer);
  });

  socket.on("rtc-offer", async (offerUserId, offer) => {
    const handleICECandidate = createICECandidateHandler(offerUserId);
    const peerConnection = createPeerConnection(handleICECandidate);
    peerConnection.setRemoteDescription(offer);
    peerConnectionsRepo.addConnection(offerUserId, peerConnection);

    const answer = await createPeerAnswer(offerUserId, peerConnection);
    socket.emit("rtc-answer", offerUserId, answer);
  });

  socket.on("rtc-answer", async (answerUserId, answer) => {
    const { connection } = peerConnectionsRepo.getConnection(answerUserId);
    connection.setRemoteDescription(answer);
  });

  socket.on("ice-candidate", async (peerUserId, candidate) => {
    const { connection } = peerConnectionsRepo.getConnection(peerUserId);
    await connection.addIceCandidate(candidate);
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

function initializeUi() {
  const form = document.getElementById("form");
  const input = document.getElementById("input");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const message = input.value;
    if (!message) {
      return;
    }

    addLogLine(LOG_ENTITY.Me, message);
    peerConnectionsRepo.sendToAllPeers(message);
    input.value = "";
  });

  const messagesEl = document.getElementById("messages-container");
  messagesEl.onscroll = updateMessagesContainerScroll;
}

function updateUserCountEl(count) {
  const el = document.getElementById("user-count");
  el.textContent = count;
}

const printUserMessage = (peerId) => (message) => {
  logPeer("Received", message);
  addLogLine(peerId, message.data || "");
};

const LOG_ENTITY = {
  Me: 0,
  Socket: 1,
  Rtc: 2,
};

function addLogLine(username, message) {
  /*
  const classNames = [];
  if (username == LOG_ENTITY.Socket) {
    classNames.push("log-socket");
    username = "[SocketServer]";
  } else if (username == LOG_ENTITY.Rtc) {
    classNames.push("log-rtc");
    username = "[WebRTC]";
  }*/
  let color = undefined;
  if (username === LOG_ENTITY.Me) {
    username = "Me";
    color = "hsl(0, 0%, 85%)";
  } else if (peerConnectionsRepo.hasConnection(username)) {
    color = peerConnectionsRepo.getConnection(username).color;
  }

  const wasAtBottom = isMessagesContainerAtBottom();

  const usernameEl = document.createElement("span");
  usernameEl.textContent = username;
  usernameEl.className = "msg-username";
  usernameEl.style.background = color;
  const dateEl = document.createElement("span");
  dateEl.textContent = getMessageDate();
  dateEl.className = "msg-date";
  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  messageEl.className = "msg-text";

  const itemEl = document.createElement("li");
  itemEl.appendChild(usernameEl);
  itemEl.appendChild(dateEl);
  itemEl.appendChild(messageEl);
  itemEl.className = "msg-container";
  // TBH not needed, 'id' atttribute creates a global variable. Would be even faster that way (cached)
  const messages = document.getElementById("messages");
  messages.appendChild(itemEl);

  if (wasAtBottom) {
    scrollMessagesContainerToBottom();
  }
}

function getMessageDate() {
  const date = new Date();
  return date.toLocaleTimeString();
}

const randomFromArray = (items) =>
  items[Math.floor(Math.random() * items.length)];

function getRandomColor() {
  const colors = [
    "lch(80.09% 47 220)",
    "lch(80.09% 47 190)",
    "lch(80.09% 47 160)",
    "lch(80.09% 47 130)",
    "lch(80.09% 47 100)",
    "lch(80.09% 47 60)",
    "lch(67.8% 47 28)",
    "lch(67.8% 47 300)",
    "lch(67.8% 47 270)",
  ];
  return randomFromArray(colors);
}

function isMessagesContainerAtBottom() {
  const el = document.getElementById("messages-container");
  const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  return toBottom < 5;
}

function scrollMessagesContainerToBottom() {
  const el = document.getElementById("messages-container");
  el.scrollTo({
    top: el.scrollHeight,
    behavior: "smooth",
  });
}

function updateMessagesContainerScroll() {
  const classHasMore = "messages-container-has-more";
  const isNearBottom = isMessagesContainerAtBottom();
  toggleClass(window.document.body, classHasMore, !isNearBottom);
}

function toggleClass(el, clazz, onOrOff) {
  console.log("toggleClass", el, clazz, onOrOff);
  el.classList.remove(clazz);
  if (onOrOff) {
    el.classList.add(clazz);
  }
}
