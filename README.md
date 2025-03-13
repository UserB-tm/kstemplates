# kstemplates
![ksLogo](https://github.com/user-attachments/assets/7c6e71b3-e2fb-43e0-b5df-1b5ba88abb58)

Browser extension to save and paste email templates locally with shortcuts via IndexedDB

This is my first attempt at a browser extension, so it may have some bugs. I've tested it in Chrome and Edge. 

**Instructions to add to Chrome: **
1. Download KS Template project files, including icon folder
2.  navigate to chrome://extensions/
3.  activate dev mode (toggle switch)
4.  Click the "Load unpacked" button.
5.  Select the KS Templates folder and hit unpack
6.  You may get some permission alerts because it needs keystroke awareness in Outlook and Gmail to be able to detect keyboard shortcuts.

What is this:
The goal of this extension was to mimic the utility of Classic Outlooks' Quick Parts feature, but for Web email. The main benifit is that it stores all your content locally, not on another domain. This extension uses IndexedDB.
My goal was not to just save plain text but all the CSS styles and images copied(converted to base64). So, if you draft an email knowedge-base artical, or a table, you should just be able to copy it to clipboard, press the keyboard shortcut to launch the extension:
"Ctrl + Shift + E", click "Add new template" button, and paste it into the contentEditable DIV. Then, set a keyboard shortcut. This will allow you to paste the content into future emails. 

Usage:
**To create a new template:**
>Create your email content, styling the way you like it, original or extra crispy. 
>Copy the content to clipboard
>Either click the extention button in the tool bar or hit "Ctrl + Shift + E"
Click Creat new template, paste the content into the textarea(contentEditable DIV)
>Create a keyboard shorcut styled like this "\wow" so Backslash + whatever

**Notes:**
Since Edge and chrome only allow local .js file API's to stay active for a period of time, you only have a window of time after you open a new email to be able to use your shortcuts. If the shortcuts don't work, refresh the browser to reconect the background.js, content.js, and IndexedDB database. 
The shortcut to launch the extension only works in Gmail and Outlook, so it can determine if Gmail or Outlook has tab focus. 

Good luck
