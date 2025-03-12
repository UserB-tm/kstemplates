const dbName = "KSTemplatesDB";
const storeName = "templates";
let db;
let port;

// Connect to the background script
function connectToBackground() {
  port = chrome.runtime.connect({ name: "popup" });
  console.log("Connected to background script");
}

// Initialize the connection when popup opens
connectToBackground();

const request = indexedDB.open(dbName, 2); // Match version 2
request.onupgradeneeded = (event) => {
  db = event.target.result;
  if (!db.objectStoreNames.contains(storeName)) {
    db.createObjectStore(storeName, { keyPath: "shortcut" });
  }
};
request.onsuccess = (event) => {
  db = event.target.result;
  loadTemplates();
};

const addTemplateBtn = document.getElementById("add-template-btn");
const addTemplateForm = document.getElementById("add-template-form");
const templateContent = document.getElementById("template-content");
const shortcutInput = document.getElementById("shortcut-input");
const saveTemplateBtn = document.getElementById("save-template-btn");
const closeBtn = document.getElementById("close-btn");
const templateList = document.getElementById("template-list");

addTemplateBtn.onclick = () => addTemplateForm.classList.toggle("hidden");
closeBtn.onclick = () => window.close();

// Focus the contenteditable area when adding a new template
addTemplateBtn.addEventListener("click", () => {
  if (!addTemplateForm.classList.contains("hidden")) {
    setTimeout(() => templateContent.focus(), 100);
  }
});

// Add paste event handler for template content
templateContent.addEventListener("paste", (e) => {
  console.log("Paste event detected");
  // Allow the paste to happen naturally, HTML formatting will be preserved
});

saveTemplateBtn.onclick = () => {
  const content = templateContent.innerHTML; // Get HTML content
  const shortcut = shortcutInput.value.trim();
  
  if (!shortcut.startsWith("\\")) {
    alert("Shortcut must start with a backslash (\\)");
    return;
  }
  
  if (content && shortcut) {
    saveTemplate(shortcut, content);
    templateContent.innerHTML = ""; // Clear contenteditable div
    shortcutInput.value = "";
    addTemplateForm.classList.add("hidden");
    
    // Notify background script that templates have been updated
    if (port) {
      port.postMessage({ type: "templatesUpdated" });
    }
  } else {
    alert("Please enter both a shortcut and content for your template");
  }
};

function saveTemplate(shortcut, content) {
  const transaction = db.transaction([storeName], "readwrite");
  const store = transaction.objectStore(storeName);
  store.put({ shortcut, content });
  transaction.oncomplete = loadTemplates;
}

function loadTemplates() {
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    templateList.innerHTML = "";
    request.result.forEach(template => {
      const row = document.createElement("tr");
      
      const shortcutCell = document.createElement("td");
      shortcutCell.textContent = template.shortcut;
      
      const previewCell = document.createElement("td");
      // Create a div to properly show HTML preview
      const previewDiv = document.createElement("div");
      previewDiv.className = "template-preview";
      
      // Set a max height and add ellipsis for overflow
      previewDiv.style.maxHeight = "80px";
      previewDiv.style.maxWidth = "300px";
      previewDiv.style.overflow = "hidden";
      previewDiv.style.textOverflow = "ellipsis";
      previewDiv.style.position = "relative";
      
      // Set the HTML content for preview
      previewDiv.innerHTML = template.content;
      
      // Add a fade-out effect at the bottom if content is large
      const fadeEffect = document.createElement("div");
      fadeEffect.className = "fade-effect";
      fadeEffect.style.position = "absolute";
      fadeEffect.style.bottom = "0";
      fadeEffect.style.left = "0";
      fadeEffect.style.right = "0";
      fadeEffect.style.height = "20px";
      fadeEffect.style.background = "linear-gradient(rgba(255,255,255,0), rgba(255,255,255,1))";
      
      previewDiv.appendChild(fadeEffect);
      previewCell.appendChild(previewDiv);
      
      const actionsCell = document.createElement("td");
      
      // Create copy button
      const copyButton = document.createElement("button");
      copyButton.className = "copy-btn";
      copyButton.setAttribute("data-shortcut", template.shortcut);
      copyButton.textContent = "Copy";
      
      // Create edit button
      const editButton = document.createElement("button");
      editButton.className = "edit-btn";
      editButton.setAttribute("data-shortcut", template.shortcut);
      editButton.textContent = "Edit";
      
      // Create delete button
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-btn";
      deleteButton.setAttribute("data-shortcut", template.shortcut);
      deleteButton.textContent = "Delete";
      
      actionsCell.appendChild(copyButton);
      actionsCell.appendChild(editButton);
      actionsCell.appendChild(deleteButton);
      
      row.appendChild(shortcutCell);
      row.appendChild(previewCell);
      row.appendChild(actionsCell);
      templateList.appendChild(row);
    });

    // Set up event listeners for action buttons
    document.querySelectorAll(".copy-btn").forEach(button => {
      button.addEventListener("click", () => {
        const shortcut = button.getAttribute("data-shortcut");
        copyTemplate(shortcut);
      });
    });
    
    document.querySelectorAll(".edit-btn").forEach(button => {
      button.addEventListener("click", () => {
        const shortcut = button.getAttribute("data-shortcut");
        editTemplate(shortcut);
      });
    });

    document.querySelectorAll(".delete-btn").forEach(button => {
      button.addEventListener("click", () => {
        const shortcut = button.getAttribute("data-shortcut");
        if (confirm(`Are you sure you want to delete the template with shortcut "${shortcut}"?`)) {
          deleteTemplate(shortcut);
        }
      });
    });
  };
}

function copyTemplate(shortcut) {
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.get(shortcut);
  request.onsuccess = () => {
    // Create a temporary div to hold HTML content
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = request.result.content;
    
    // Append to body, select, copy, then remove
    document.body.appendChild(tempDiv);
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    document.body.removeChild(tempDiv);
    
    // Show a temporary success message
    const status = document.createElement("div");
    status.textContent = "Template copied to clipboard!";
    status.style.position = "fixed";
    status.style.top = "10px";
    status.style.left = "50%";
    status.style.transform = "translateX(-50%)";
    status.style.padding = "10px";
    status.style.background = "#203731";
    status.style.color = "#FFB612";
    status.style.borderRadius = "5px";
    status.style.zIndex = "1000";
    document.body.appendChild(status);
    
    setTimeout(() => {
      document.body.removeChild(status);
    }, 2000);
    
    console.log(`Copied template for shortcut: ${shortcut}`);
  };
}

function editTemplate(shortcut) {
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.get(shortcut);
  
  request.onsuccess = () => {
    const template = request.result;
    if (template) {
      // Show the template form
      addTemplateForm.classList.remove("hidden");
      
      // Fill in the existing template data
      templateContent.innerHTML = template.content;
      shortcutInput.value = template.shortcut;
      
      // Focus on the content area
      templateContent.focus();
      
      // When save is clicked, we'll delete the old template and add the new one
      saveTemplateBtn.onclick = () => {
        const newContent = templateContent.innerHTML;
        const newShortcut = shortcutInput.value.trim();
        
        if (newContent && newShortcut) {
          // If the shortcut changed, delete the old one
          if (newShortcut !== shortcut) {
            deleteTemplate(shortcut, false);
          }
          
          // Save the updated template
          saveTemplate(newShortcut, newContent);
          templateContent.innerHTML = "";
          shortcutInput.value = "";
          addTemplateForm.classList.add("hidden");
          
          // Reset the save button behavior
          saveTemplateBtn.onclick = saveTemplateBtn.dataset.originalOnClick;
          
          // Notify background script that templates have been updated
          if (port) {
            port.postMessage({ type: "templatesUpdated" });
          }
        }
      };
      
      // Store the original onClick handler
      if (!saveTemplateBtn.dataset.originalOnClick) {
        saveTemplateBtn.dataset.originalOnClick = saveTemplateBtn.onclick;
      }
    }
  };
}

function deleteTemplate(shortcut, reload = true) {
  const transaction = db.transaction([storeName], "readwrite");
  const store = transaction.objectStore(storeName);
  store.delete(shortcut);
  transaction.oncomplete = () => {
    console.log(`Deleted template for shortcut: ${shortcut}`);
    if (reload) {
      loadTemplates();
      
      // Notify background script that templates have been updated
      if (port) {
        port.postMessage({ type: "templatesUpdated" });
      }
    }
  };
}

// Add keyboard shortcut handling for the popup
document.addEventListener("keydown", (e) => {
  // Close popup on Escape key
  if (e.key === "Escape") {
    window.close();
  }
  
  // Save template on Ctrl+Enter when focus is in the form
  if (e.ctrlKey && e.key === "Enter") {
    if (!addTemplateForm.classList.contains("hidden")) {
      saveTemplateBtn.click();
    }
  }
});