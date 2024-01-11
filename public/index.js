/////////////////////////////
// PeerConnectionsRepo

/** Struct that holds references to all the connections */
class PeerConnectionsRepo {
  constructor() {
    this.connections = {};
  }

  addConnection(peerId, peerConnection) {
    this.deleteConnection(peerId);
    const c = {
      peerId,
      connection: peerConnection,
      color: getRandomColor(), // "#00dbff",
      channel: undefined,
    };
    this.connections[peerId] = c;
    this._updateUserCount();
    return c;
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

  deleteConnection = (peerId) => {
    if (this.hasConnection(peerId)) {
      const c = this.getConnection(peerId);
      c.connection.close();
      // Careful for event sequence, do not send it twice.
      // Could happen if both socket and RPCDataChannel detect that peer has left.
      renderSystemMessage(c, `User has left the chat`);
    }
    delete this.connections[peerId];
    this._updateUserCount();
  };

  deleteAllConnections() {
    const peers = Object.keys(this.connections);
    peers.forEach((peerId) => {
      const c = this.getConnection(peerId);
      c.connection.close();
      delete this.connections[peerId];
    });
    this._updateUserCount();
  }

  setChannel(peerId, channel) {
    const peerConnection = this.getConnection(peerId);
    peerConnection.channel = channel;

    channel.onmessage = printUserMessage(peerId);
    channel.onclose = () => {
      logPeer(peerId, "RTCDataChannel closed, peer user disconnected");
      this.deleteConnection(peerId);
    };
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
// Room id storage etc.
const LOCAL_STORAGE_ROOM_ID_KEY = "roomId";

const isValidRoomId = (roomId) =>
  roomId &&
  typeof roomId === "string" &&
  roomId.length > 3 &&
  roomId !== String(undefined);

function getRoomIdFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const roomId = searchParams.get("roomId");
  return isValidRoomId(roomId) ? roomId : undefined;
}

const setLocalStorageRoom = (roomId) => {
  if (!roomId) {
    localStorage.removeItem(LOCAL_STORAGE_ROOM_ID_KEY);
  } else {
    localStorage.setItem(LOCAL_STORAGE_ROOM_ID_KEY, roomId);
  }
};

const getLocalStorageRoom = () => {
  const roomId = localStorage.getItem(LOCAL_STORAGE_ROOM_ID_KEY);
  return isValidRoomId(roomId) ? roomId : undefined;
};

function getRoomId() {
  const fromUrl = getRoomIdFromUrl();
  const fromLocalStorage = getLocalStorageRoom();
  console.log("Retrieving roomId:", {
    fromUrl,
    fromLocalStorage,
  });
  if (fromUrl) return fromUrl;
  if (fromLocalStorage) return fromLocalStorage;
  return undefined;
}

function createUrlWithRoomId(roomId) {
  return `${window.location.origin}?roomId=${roomId}`;
}

/** Remove query params, local storage, redirect back to '/' to start new room */
function leaveRoom() {
  peerConnectionsRepo.deleteAllConnections();
  setLocalStorageRoom(undefined);
  // reload page without query params
  window.location = window.location.href.split("?")[0];
}

/////////////////////////////
// WebRTC related

// Could use https://www.metered.ca/tools/openrelay/ for free TURN too
const ICE_SERVERS = {
  iceServers: [
    {
      urls: ["stun:openrelay.metered.ca:80", "stun:stun.l.google.com:19302"],
    },
  ],
};

const createPeerConnection = (socket, peerId) => {
  const connection = new RTCPeerConnection(ICE_SERVERS);

  connection.onicecandidate = (event) => {
    logPeer(peerId, `Created ICE candidate to '${peerId}:'`, event);

    if (event.candidate !== null) {
      socket.emit("ice-candidate", peerId, event.candidate);
    }

    const c = peerConnectionsRepo.getConnection(peerId);
    renderSystemMessage(c, `Found ICE candidate`);
  };

  connection.onconnectionstatechange = () => {
    logPeer(
      peerId,
      `Connection state changed '${peerId}:'`,
      connection.connectionState,
    );
    // not exactly reliable TBH. Use RTCDataChannel.onclose instead
    if (connection.connectionState === "closed") {
      peerConnectionsRepo.deleteConnection(peerId);
    }
  };
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

    // create offer
    const offer = await peerConnection.createOffer();
    peerConnection.setLocalDescription(offer);
    logPeer(peerId, "[OFFER]", offer);
    return offer;
  } catch (error) {
    logPeer(peerId, "[OFFER Error]", error);
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
        channel.send("Hi, I am new to this chat room!");
      };
    };

    // create answer
    const answer = await peerConnection.createAnswer();
    peerConnection.setLocalDescription(answer);
    logPeer(peerId, "[ANSWER]", answer);
    return answer;
  } catch (error) {
    logPeer(peerId, "[ANSWER Error]", error);
    throw error;
  }
}

/////////////////////////////
// Socket related

const createSocketConnection = () => {
  const socket = io();
  socket.onAny((...args) => {
    const [name, ...args2] = args;
    logSocket(`Received '${name}', args`, ...args2);
  });

  socket.on("disconnect", () => {
    renderSystemMessage(`Lost connection to the socket server`);
    renderSystemMessage(
      `You can still send peer-to-peer messages, but there are no delivery guarantees`,
    );
    renderSystemMessage(`Other users may assume you have left the room`);
  });

  return socket;
};

function createChatRoom(socket) {
  console.log(`Creating new chat room`);
  renderSystemMessage(`Creating new chat room`);
  socket.emit("create-room");
}

function joinChatRoom(socket, roomId) {
  console.log(`Joining room '${roomId}'`);
  renderSystemMessage(`Joining room '${roomId}'`);
  renderSystemMessage(`Awaiting ICE offers from other chat room members`);
  socket.emit("join-room", roomId);
}

/////////////////////////////
// main

let userName = undefined;

(async function main() {
  initializeUi();

  const socket = createSocketConnection();
  userName = socket.id;

  const existingRoomId = getRoomId();
  if (existingRoomId) {
    joinChatRoom(socket, existingRoomId);
  } else {
    createChatRoom(socket);
  }

  socket.on("room-created", (roomId) => {
    setLocalStorageRoom(roomId);

    if (existingRoomId) {
      renderSystemMessage(
        `Tried to join chat room '${existingRoomId}' that does not exist`,
      );
    }

    const linkEl = createRoomUrlLinkEl(roomId);
    renderSystemMessage(`New chat room '${roomId}' created`);
    renderSystemMessage(`Share link: `, linkEl);
    renderSystemMessage(`Awaiting new users.`);
  });

  socket.on("new-user-joined", async (newUserId) => {
    const peerConnection = createPeerConnection(socket, newUserId);
    const c = peerConnectionsRepo.addConnection(newUserId, peerConnection);
    renderSystemMessage(c, `New user joined. Sending ICE offer.`);

    const offer = await createPeerOffer(newUserId, peerConnection);
    socket.emit("rtc-offer", newUserId, offer);
  });

  socket.on("rtc-offer", async (offerUserId, offer) => {
    const peerConnection = createPeerConnection(socket, offerUserId);
    peerConnection.setRemoteDescription(offer);
    const c = peerConnectionsRepo.addConnection(offerUserId, peerConnection);
    renderSystemMessage(c, `Received ICE offer. Sending answer.`);

    const answer = await createPeerAnswer(offerUserId, peerConnection);
    socket.emit("rtc-answer", offerUserId, answer);
  });

  socket.on("rtc-answer", async (answerUserId, answer) => {
    const c = peerConnectionsRepo.getConnection(answerUserId);
    const { connection } = c;
    connection.setRemoteDescription(answer);
    renderSystemMessage(
      c,
      `Received ICE answer. Starting CANDIDATE PAIR checks.`,
    );
  });

  socket.on("ice-candidate", async (peerUserId, candidate) => {
    const c = peerConnectionsRepo.getConnection(peerUserId);
    const { connection } = c;
    await connection.addIceCandidate(candidate);
    renderSystemMessage(c, `Received ICE candidate from the peer`);
  });

  socket.on("user-disconnected", (peerUserId) =>
    peerConnectionsRepo.deleteConnection(peerUserId),
  );
})();

function logSocket(...args) {
  console.log("[Socket]", ...args);
}

function logPeer(peerId, ...args) {
  console.log(`[WebRTC ${peerId}]`, ...args);
}

/////////////////////////////
// ui

/** Special value indicating that we are the author of the message */
const USERNAME_ME = undefined;

function initializeUi() {
  const form = document.getElementById("form");
  const input = document.getElementById("input");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const message = input.value;
    if (!message) {
      return;
    }

    renderUserMessage(USERNAME_ME, message);
    peerConnectionsRepo.sendToAllPeers(message);
    input.value = "";
  });

  const disconnectBtn = document.getElementById("disconnect-btn");
  disconnectBtn.onclick = leaveRoom;

  const shareBtn = document.getElementById("share-btn");
  shareBtn.onclick = shareRoomLink;

  const messagesEl = document.getElementById("messages-container");
  messagesEl.onscroll = updateMessagesContainerScroll;
}

async function shareRoomLink() {
  const roomId = getRoomId();
  if (!roomId) {
    renderSystemMessage(
      `Cannot share chat room yet. Please retry in a few seconds`,
    );
    return;
  }

  const linkEl = createRoomUrlLinkEl(roomId);
  renderSystemMessage(`Chat room share link: `, linkEl);
  try {
    await navigator.clipboard.writeText(link);
    renderSystemMessage(`It has been added to your clipboard`);
  } catch (e) {
    console.log("Could not update clipboard", e);
  }
}

function updateUserCountEl(count) {
  const el = document.getElementById("user-count");
  el.textContent = count;
}

function createRoomUrlLinkEl(roomId) {
  const link = createUrlWithRoomId(roomId);
  const el = document.createElement("a");
  el.href = link;
  el.rel = "noopener noreferrer nofollow";
  el.target = "_blank";
  el.textContent = link;
  el.className = "msg-link";
  return el;
}

/////////////////////////////
// render messages

const printUserMessage = (peerId) => (message) => {
  logPeer(peerId, "Received", message);
  renderUserMessage(peerId, message.data || "");
};

function renderUserMessage(peerId, message) {
  let color = undefined;
  if (peerId === USERNAME_ME) {
    peerId = "Me";
    color = "hsl(0, 0%, 85%)";
  } else if (peerConnectionsRepo.hasConnection(peerId)) {
    color = peerConnectionsRepo.getConnection(peerId).color;
  }

  const usernameEl = document.createElement("span");
  usernameEl.textContent = peerId;
  usernameEl.className = "msg-username";
  usernameEl.style.background = color;
  const dateEl = document.createElement("span");
  dateEl.textContent = getMessageDate();
  dateEl.className = "msg-date";
  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  messageEl.className = "msg-text";

  appendMessage("msg-text-container", [usernameEl, dateEl, messageEl]);
}

function getMessageDate() {
  const date = new Date();
  return date.toLocaleTimeString();
}

function renderSystemMessage(peerConnection, ...msgParts) {
  if (typeof peerConnection !== "object") {
    msgParts = [peerConnection, ...msgParts];
    peerConnection = undefined;
  }

  let usernameEl = undefined;
  if (peerConnection) {
    usernameEl = document.createElement("span");
    usernameEl.textContent = peerConnection.peerId;
    usernameEl.className = "msg-username";
    usernameEl.style.color = peerConnection.color;
    usernameEl.style.padding = "0";
  }
  const msgElements = msgParts.map((msgPart) => {
    if (typeof msgPart !== "string") {
      return msgPart;
    }
    const textEl = document.createElement("span");
    textEl.textContent = msgPart;
    textEl.className = "msg-system-text";
    return textEl;
  });

  appendMessage("msg-system-container", [usernameEl, ...msgElements]);
}

function appendMessage(className, children) {
  const wasAtBottom = isMessagesContainerAtBottom();

  const itemEl = document.createElement("li");
  itemEl.classList.add(className);
  itemEl.classList.add("msg-container");
  children.forEach((ch) => Boolean(ch) && itemEl.appendChild(ch));

  // TBH not needed, 'id' atttribute creates a global variable. Would be even faster that way (cached)
  const messages = document.getElementById("messages");
  messages.appendChild(itemEl);

  if (wasAtBottom) {
    scrollMessagesContainerToBottom();
  }
}

/////////////////////////////
// ui - messages container scroll behaviour

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
  setClass(window.document.body, classHasMore, !isNearBottom);
}

function setClass(el, clazz, addClass) {
  el.classList.remove(clazz);
  if (addClass) {
    el.classList.add(clazz);
  }
}

/////////////////////////////
// misc

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
