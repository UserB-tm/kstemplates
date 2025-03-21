console.log("Background script loaded");

let typingBuffer = "";
const dbName = "KSTemplatesDB";
const storeName = "templates";

let activeTabId = null;
let activePort = null;
let recentInsertions = {};
let templatesCache = [];

// Save debug information for troubleshooting
let debugLog = [];
function logDebug(message) {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp}: ${message}`;
  console.log(entry);
  debugLog.push(entry);
  // Keep log size manageable
  if (debugLog.length > 100) {
    debugLog.shift();
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "shortcut" });
        logDebug("Object store 'templates' created");
      }
    };
    request.onsuccess = (event) => {
      logDebug("Database opened successfully");
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      logDebug("Failed to open database: " + event.target.error);
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
      logDebug(`Loaded ${templatesCache.length} templates into cache`);
    };
    request.onerror = (event) => {
      logDebug("Error fetching templates: " + event.target.error);
    };
  }).catch(error => {
    logDebug("Database error: " + error);
  });
}

loadTemplatesCache();

// Improved command listener
chrome.commands.onCommand.addListener((command) => {
  logDebug("Command received: " + command);
  if (command === "open-popup") {
    logDebug("Attempting to open popup via keyboard shortcut");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        try {
          chrome.action.openPopup(() => {
            if (chrome.runtime.lastError) {
              logDebug("Error opening popup: " + chrome.runtime.lastError.message);
              // Fallback: Send message to content script to trigger popup
              chrome.tabs.sendMessage(activeTabId, { type: "openPopup" });
            } else {
              logDebug("Popup opened successfully");
            }
          });
        } catch (e) {
          logDebug("Exception opening popup: " + e);
        }
      } else {
        logDebug("No active tab found");
      }
    });
  }
});

function checkForTemplateMatch(buffer, tabId) {
  logDebug("Checking for template match in: " + buffer);
  
  // First check the cache for performance
  const match = templatesCache.find(t => buffer.endsWith(t.shortcut));
  if (match) {
    const now = Date.now();
    if (recentInsertions[match.shortcut] && now - recentInsertions[match.shortcut] < 1500) {
      logDebug("Skipping duplicate insertion for: " + match.shortcut);
      return;
    }
    logDebug("Matched shortcut from cache: " + match.shortcut);
    recentInsertions[match.shortcut] = now;
    insertTemplate(tabId, match.content, match.shortcut);
    typingBuffer = "";
    return;
  }
  
  // If not found in cache, check the database (might have been updated)
  openDB().then(db => {
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => {
      const templates = request.result;
      
      // Enhanced matching for more reliability:
      // 1. Exact end match (standard)
      let match = templates.find(t => buffer.endsWith(t.shortcut));
      
      // 2. Case-insensitive match as fallback (helps with capitalization issues)
      if (!match) {
        match = templates.find(t => 
          buffer.toLowerCase().endsWith(t.shortcut.toLowerCase())
        );
        if (match) {
          logDebug("Found case-insensitive match for: " + match.shortcut);
        }
      }
      
      // 3. Partial match as a last resort (helps with potential buffer truncation)
      if (!match && buffer.length >= 3) {
        // Only try this with the last few characters to avoid false positives
        const lastChars = buffer.slice(-5);
        const possibleMatches = templates.filter(t => 
          t.shortcut.includes(lastChars) || lastChars.includes(t.shortcut)
        );
        
        if (possibleMatches.length === 1) {
          match = possibleMatches[0];
          logDebug("Found partial match as fallback: " + match.shortcut);
        }
      }
      
      if (match) {
        const now = Date.now();
        if (recentInsertions[match.shortcut] && now - recentInsertions[match.shortcut] < 1500) {
          logDebug("Skipping duplicate insertion for: " + match.shortcut);
          return;
        }
        logDebug("Matched shortcut from database: " + match.shortcut);
        recentInsertions[match.shortcut] = now;
        insertTemplate(tabId, match.content, match.shortcut);
        typingBuffer = "";
        
        // Update cache with the latest templates to ensure it's current
        templatesCache = templates;
      }
    };
    request.onerror = (event) => {
      logDebug("Error fetching templates: " + event.target.error);
    };
  }).catch(error => {
    logDebug("Database error: " + error);
  });
}

function insertTemplate(tabId, content, shortcut) {
  if (tabId) {
    logDebug(`Sending template insertion request to tab ${tabId} for shortcut: ${shortcut}`);
    chrome.tabs.sendMessage(tabId, { 
      type: "insertTemplate", 
      content: content, 
      shortcut: shortcut
    }, response => {
      // Check for any communication errors
      if (chrome.runtime.lastError) {
        logDebug("Error sending template to content script: " + chrome.runtime.lastError.message);
      } else if (response) {
        logDebug("Content script responded: " + JSON.stringify(response));
      }
    });
  } else {
    logDebug("Cannot insert template: No active tab ID");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Capture the tab ID from the sender for future communications
  if (sender.tab) {
    activeTabId = sender.tab.id;
    logDebug(`Message from tab ${activeTabId}: ${message.type}`);
  } else {
    logDebug(`Message without tab ID: ${message.type}`);
  }
  
  if (message.type === "keydown") {
    logDebug(`Received key: ${message.key}, from: ${message.elementType || "unknown"}`);
    typingBuffer += message.key;
    if (typingBuffer.length > 30) typingBuffer = typingBuffer.slice(-30);
    checkForTemplateMatch(typingBuffer, activeTabId);
  } 
  else if (message.type === "inputChange") {
    logDebug(`Received input change: ${message.text}`);
    // For input changes, replace the entire buffer to ensure accuracy
    typingBuffer = message.text;
    checkForTemplateMatch(typingBuffer, activeTabId);
  }
  else if (message.type === "shortcutDetected") {
    logDebug(`Shortcut detected by content script: ${message.shortcut}`);
    const now = Date.now();
    if (recentInsertions[message.shortcut] && now - recentInsertions[message.shortcut] < 1500) {
      logDebug(`Skipping duplicate shortcut detection: ${message.shortcut}`);
      return true;
    }
    recentInsertions[message.shortcut] = now;
    
    // Directly search for the template
    openDB().then(db => {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(message.shortcut);
      request.onsuccess = () => {
        if (request.result) {
          logDebug(`Found template for shortcut: ${message.shortcut}`);
          insertTemplate(activeTabId, request.result.content, message.shortcut);
        } else {
          // Try a case-insensitive search as fallback
          const allRequest = store.getAll();
          allRequest.onsuccess = () => {
            const match = allRequest.result.find(t => 
              t.shortcut.toLowerCase() === message.shortcut.toLowerCase()
            );
            if (match) {
              logDebug(`Found case-insensitive match for: ${message.shortcut}`);
              insertTemplate(activeTabId, match.content, match.shortcut);
            } else {
              logDebug(`Shortcut not found in database: ${message.shortcut}`);
            }
          };
        }
      };
    }).catch(error => {
      logDebug(`Database error: ${error}`);
    });
  }
  else if (message.type === "openPopup") {
    logDebug("Received request to open popup from content script");
    chrome.action.openPopup(() => {
      if (chrome.runtime.lastError) {
        logDebug(`Error opening popup from content script: ${chrome.runtime.lastError.message}`);
      }
    });
  }
  else if (message.type === "getDebugLog") {
    sendResponse({log: debugLog});
  }
  
  // Return true to indicate we want to use sendResponse asynchronously
  return true;
});

// Clean up recent insertions periodically
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
    logDebug("Popup connected");
    activePort = port;
    port.onMessage.addListener((message) => {
      if (message.type === "templatesUpdated") {
        logDebug("Templates updated, refreshing cache");
        loadTemplatesCache();
      }
    });
    port.onDisconnect.addListener(() => {
      logDebug("Popup disconnected");
      activePort = null;
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  logDebug(`Active tab changed to: ${activeTabId}`);
});

logDebug("KS Templates background script initialized");