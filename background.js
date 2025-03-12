console.log("Background script loaded");

let typingBuffer = "";
const dbName = "KSTemplatesDB";
const storeName = "templates";

let activeTabId = null;
let activePort = null;
let recentInsertions = {};
let templatesCache = [];

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "shortcut" });
        console.log("Object store 'templates' created");
      }
    };
    request.onsuccess = (event) => {
      console.log("Database opened successfully");
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      console.error("Failed to open database:", event.target.error);
      reject(event.target.error);
    };
  });
}

function loadTemplatesCache() {
  openDB().then(db => {
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => {
      templatesCache = request.result;
      console.log(`Loaded ${templatesCache.length} templates into cache`);
    };
    request.onerror = (event) => {
      console.error("Error fetching templates:", event.target.error);
    };
  }).catch(error => {
    console.error("Database error:", error);
  });
}

loadTemplatesCache();

// Improved command listener
chrome.commands.onCommand.addListener((command) => {
  console.log("Command received:", command);
  if (command === "open-popup") {
    console.log("Attempting to open popup via keyboard shortcut");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        try {
          chrome.action.openPopup(() => {
            if (chrome.runtime.lastError) {
              console.error("Error opening popup:", chrome.runtime.lastError.message);
              // Fallback: Send message to content script to trigger popup
              chrome.tabs.sendMessage(activeTabId, { type: "openPopup" });
            } else {
              console.log("Popup opened successfully");
            }
          });
        } catch (e) {
          console.error("Exception opening popup:", e);
        }
      } else {
        console.error("No active tab found");
      }
    });
  }
});

function checkForTemplateMatch(buffer, tabId) {
  console.log("Checking for template match in:", buffer);
  const match = templatesCache.find(t => buffer.endsWith(t.shortcut));
  if (match) {
    const now = Date.now();
    if (recentInsertions[match.shortcut] && now - recentInsertions[match.shortcut] < 1500) {
      console.log("Skipping duplicate insertion for:", match.shortcut);
      return;
    }
    console.log("Matched shortcut from cache:", match.shortcut);
    recentInsertions[match.shortcut] = now;
    insertTemplate(tabId, match.content, match.shortcut);
    typingBuffer = "";
    return;
  }
  openDB().then(db => {
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => {
      const templates = request.result;
      const match = templates.find(t => buffer.endsWith(t.shortcut));
      if (match) {
        const now = Date.now();
        if (recentInsertions[match.shortcut] && now - recentInsertions[match.shortcut] < 1500) {
          console.log("Skipping duplicate insertion for:", match.shortcut);
          return;
        }
        console.log("Matched shortcut from database:", match.shortcut);
        recentInsertions[match.shortcut] = now;
        insertTemplate(tabId, match.content, match.shortcut);
        typingBuffer = "";
      }
    };
    request.onerror = (event) => {
      console.error("Error fetching templates:", event.target.error);
    };
  }).catch(error => {
    console.error("Database error:", error);
  });
}

function insertTemplate(tabId, content, shortcut) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { 
      type: "insertTemplate", 
      content: content, 
      shortcut: shortcut
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab) {
    activeTabId = sender.tab.id;
  }
  
  if (message.type === "keydown") {
    console.log("Received key:", message.key, "from:", message.elementType || "unknown");
    typingBuffer += message.key;
    if (typingBuffer.length > 20) typingBuffer = typingBuffer.slice(-20);
    checkForTemplateMatch(typingBuffer, activeTabId);
  } 
  else if (message.type === "inputChange") {
    console.log("Received input change:", message.text);
    typingBuffer = message.text;
    checkForTemplateMatch(typingBuffer, activeTabId);
  }
  else if (message.type === "shortcutDetected") {
    console.log("Shortcut detected by content script:", message.shortcut);
    const now = Date.now();
    if (recentInsertions[message.shortcut] && now - recentInsertions[message.shortcut] < 1500) {
      console.log("Skipping duplicate shortcut detection:", message.shortcut);
      return;
    }
    recentInsertions[message.shortcut] = now;
    openDB().then(db => {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(message.shortcut);
      request.onsuccess = () => {
        if (request.result) {
          insertTemplate(activeTabId, request.result.content, message.shortcut);
        } else {
          console.log("Shortcut not found in database:", message.shortcut);
        }
      };
    }).catch(error => {
      console.error("Database error:", error);
    });
  }
  else if (message.type === "openPopup") {
    console.log("Received request to open popup from content script");
    chrome.action.openPopup(() => {
      if (chrome.runtime.lastError) {
        console.error("Error opening popup from content script:", chrome.runtime.lastError.message);
      }
    });
  }
  return true;
});

setInterval(() => {
  const now = Date.now();
  for (const shortcut in recentInsertions) {
    if (now - recentInsertions[shortcut] > 5000) {
      delete recentInsertions[shortcut];
    }
  }
}, 10000);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    console.log("Popup connected");
    activePort = port;
    port.onMessage.addListener((message) => {
      if (message.type === "templatesUpdated") {
        console.log("Templates updated, refreshing cache");
        loadTemplatesCache();
      }
    });
    port.onDisconnect.addListener(() => {
      console.log("Popup disconnected");
      activePort = null;
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  console.log("Active tab changed to:", activeTabId);
});

console.log("KS Templates background script initialized");