/**
 * Shop AI Chat - Client-side implementation
 *
 * This module handles the chat interface for the Shopify AI Chat application.
 * It manages the UI interactions, API communication, and message rendering.
 */
(function() {
  'use strict';

  /**
   * Cookie utility functions for persistent storage
   */
  const CookieUtils = {
    /**
     * Set a cookie
     * @param {string} name - Cookie name
     * @param {string} value - Cookie value
     * @param {number} days - Expiration in days (default: 90)
     */
    set: function(name, value, days = 90) {
      const expires = new Date();
      expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
      document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
    },

    /**
     * Get a cookie value
     * @param {string} name - Cookie name
     * @returns {string|null} - Cookie value or null
     */
    get: function(name) {
      const nameEQ = name + '=';
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i];
        while (cookie.charAt(0) === ' ') {
          cookie = cookie.substring(1, cookie.length);
        }
        if (cookie.indexOf(nameEQ) === 0) {
          return cookie.substring(nameEQ.length, cookie.length);
        }
      }
      return null;
    },

    /**
     * Delete a cookie
     * @param {string} name - Cookie name
     */
    delete: function(name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
    }
  };

  /**
   * Application namespace to prevent global scope pollution
   */
  const ShopAIChat = {
    /**
     * Play a notification sound when messages are received
     */
    playNotificationSound: function() {
      try {
        // Create a simple notification sound using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        // Configure the sound (gentle notification)
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800; // Frequency in Hz (higher = higher pitch)
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Volume
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15); // Fade out
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
      } catch (error) {
        // Fallback: If Web Audio API fails, silently fail (doesn't break chat)
        console.log('Could not play notification sound:', error);
      }
    },

    /**
     * UI-related elements and functionality
     */
    UI: {
      elements: {},
      isMobile: false,
      isStreaming: false, // Track if a response is currently streaming
      displayedMessageIds: new Set(), // Track IDs of messages we've already displayed to prevent duplicates

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function(container) {
        if (!container) return;

        // Cache DOM elements
        this.elements = {
          container: container,
          chatBubble: container.querySelector('.shop-ai-chat-bubble'),
          chatWindow: container.querySelector('.shop-ai-chat-window'),
          closeButton: container.querySelector('.shop-ai-chat-close'),
          chatInput: container.querySelector('.shop-ai-chat-input input'),
          sendButton: container.querySelector('.shop-ai-chat-send'),
          resetButton: container.querySelector('.shop-ai-chat-reset'),
          messagesContainer: container.querySelector('.shop-ai-chat-messages')
        };

        // Detect mobile device
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Set up event listeners
        this.setupEventListeners();

        // Fix for iOS Safari viewport height issues
        if (this.isMobile) {
          this.setupMobileViewport();
        }
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function() {
        const { chatBubble, closeButton, chatInput, sendButton, resetButton, messagesContainer } = this.elements;

        // Toggle chat window visibility
        chatBubble.addEventListener('click', () => this.toggleChatWindow());

        // Close chat window
        closeButton.addEventListener('click', () => this.closeChatWindow());

        // Send message when pressing Enter in input
        chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, handle keyboard
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // Send message when clicking send button
        sendButton.addEventListener('click', () => {
          if (chatInput.value.trim() !== '') {
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, focus input after sending
            if (this.isMobile) {
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // Reset chat when clicking reset button
        resetButton.addEventListener('click', () => {
          ShopAIChat.Message.resetChat(messagesContainer);
        });

        // Handle window resize to adjust scrolling
        window.addEventListener('resize', () => this.scrollToBottom());

        // Add global click handler for auth links
        document.addEventListener('click', function(event) {
          if (event.target && event.target.classList.contains('shop-auth-trigger')) {
            event.preventDefault();
            if (window.shopAuthUrl) {
              ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
            }
          }
        });
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function() {
        const setViewportHeight = () => {
          document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
        };
        window.addEventListener('resize', setViewportHeight);
        setViewportHeight();
      },

      /**
       * Toggle chat window visibility
       */
      toggleChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.toggle('active');

        if (chatWindow.classList.contains('active')) {
          // Hide unread indicator when chat is opened
          this.hideUnreadIndicator();
          
          // On mobile, prevent body scrolling and delay focus
          if (this.isMobile) {
            document.body.classList.add('shop-ai-chat-open');
            setTimeout(() => chatInput.focus(), 500);
          } else {
            chatInput.focus();
          }
          // Always scroll messages to bottom when opening
          this.scrollToBottom();
        } else {
          // Remove body class when closing
          document.body.classList.remove('shop-ai-chat-open');
          
          // Check for unread messages when chat is closed
          setTimeout(() => this.checkUnreadMessages(), 1000);
        }
      },

      /**
       * Close chat window
       */
      closeChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.remove('active');

        // Hide unread indicator when chat is closed
        this.hideUnreadIndicator();

        // On mobile, blur input to hide keyboard and enable body scrolling
        if (this.isMobile) {
          chatInput.blur();
          document.body.classList.remove('shop-ai-chat-open');
        }
        
        // Check for unread messages when chat is closed
        setTimeout(() => this.checkUnreadMessages(), 1000);
      },

      /**
       * Scroll messages container to bottom
       */
      scrollToBottom: function() {
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
      },

      /**
       * Show typing indicator in the chat
       */
      showTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('shop-ai-typing-indicator');
        typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        messagesContainer.appendChild(typingIndicator);
        this.scrollToBottom();
      },

      /**
       * Remove typing indicator from the chat
       */
      removeTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = messagesContainer.querySelector('.shop-ai-typing-indicator');
        if (typingIndicator) {
          typingIndicator.remove();
        }
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function(products) {
        const { messagesContainer } = this.elements;

        // Create a wrapper for the product section
        const productSection = document.createElement('div');
        productSection.classList.add('shop-ai-product-section');
        messagesContainer.appendChild(productSection);

        // Add a header for the product results
        const header = document.createElement('div');
        header.classList.add('shop-ai-product-header');
        header.innerHTML = '<h4>Top Matching Products</h4>';
        productSection.appendChild(header);

        // Create the product grid container
        const productsContainer = document.createElement('div');
        productsContainer.classList.add('shop-ai-product-grid');
        productSection.appendChild(productsContainer);

        if (!products || !Array.isArray(products) || products.length === 0) {
          const noProductsMessage = document.createElement('p');
          noProductsMessage.textContent = "No products found";
          noProductsMessage.style.padding = "10px";
          productsContainer.appendChild(noProductsMessage);
        } else {
          products.forEach(product => {
            const productCard = ShopAIChat.Product.createCard(product);
            productsContainer.appendChild(productCard);
          });
        }

        this.scrollToBottom();
      },

      /**
       * Show unread message indicator on chat bubble
       * @param {number} count - Number of unread messages
       */
      showUnreadIndicator: function(count) {
        const { chatBubble } = this.elements;
        
        // Remove existing indicator if any
        this.hideUnreadIndicator();
        
        if (count > 0) {
          const indicator = document.createElement('div');
          indicator.classList.add('shop-ai-unread-indicator');
          indicator.textContent = count > 99 ? '99+' : count.toString();
          chatBubble.appendChild(indicator);
        }
      },

      /**
       * Hide unread message indicator
       */
      hideUnreadIndicator: function() {
        const { chatBubble } = this.elements;
        const indicator = chatBubble.querySelector('.shop-ai-unread-indicator');
        if (indicator) {
          indicator.remove();
        }
      },

      /**
       * Check for unread messages and update indicator
       */
      checkUnreadMessages: function() {
        const conversationId = CookieUtils.get('shopAiConversationId');
        if (!conversationId) return;

        // Check if chat window is open
        const { chatWindow } = this.elements;
        const isChatOpen = chatWindow.classList.contains('active');
        
        if (!isChatOpen) {
          // Only check for unread messages when chat is closed
          ShopAIChat.API.checkUnreadMessages(conversationId, this);
        }
      },

      /**
       * Check for recent messages and display them live
       */
      checkRecentMessages: function() {
        const conversationId = CookieUtils.get('shopAiConversationId');
        if (!conversationId) return;

        // Don't check if actively streaming a response
        if (this.isStreaming) {
          console.log('[POLL DEBUG] Skipping poll: isStreaming = true');
          return;
        }

        // Check if chat window is open
        const { chatWindow } = this.elements;
        const isChatOpen = chatWindow.classList.contains('active');
        
        if (isChatOpen) {
          // Get last message timestamp
          const lastTimestamp = this.lastMessageTimestamp || new Date(0).toISOString();
          const { messagesContainer } = this.elements;
          
          console.log('[POLL DEBUG] Checking for recent messages since:', lastTimestamp);
          
          // Check for recent messages and update last timestamp
          ShopAIChat.API.checkRecentMessages(conversationId, lastTimestamp, messagesContainer)
            .then(newTimestamp => {
              if (newTimestamp && newTimestamp !== lastTimestamp) {
                console.log('[POLL DEBUG] Updated lastMessageTimestamp from', lastTimestamp, 'to', newTimestamp);
                this.lastMessageTimestamp = newTimestamp;
              } else {
                console.log('[POLL DEBUG] No new messages, timestamp unchanged:', lastTimestamp);
              }
            });
        }
      }
    },

    /**
     * Message handling and display functionality
     */
    Message: {
      /**
       * Send a message to the API
       * @param {HTMLInputElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      send: async function(chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        const conversationId = CookieUtils.get('shopAiConversationId');

        // Add user message to chat
        this.add(userMessage, 'user', messagesContainer);

        // Clear input
        chatInput.value = '';

        // Show typing indicator
        ShopAIChat.UI.showTypingIndicator();

        try {
          ShopAIChat.API.streamResponse(userMessage, conversationId, messagesContainer);
        } catch (error) {
          console.error('Error communicating with Claude API:', error);
          ShopAIChat.UI.removeTypingIndicator();
          this.add("Sorry, I couldn't process your request at the moment. Please try again later.", 'assistant', messagesContainer);
        }
      },

      /**
       * Reset chat by clearing conversation history and showing welcome message
       * @param {HTMLElement} messagesContainer - The messages container
       */
      resetChat: async function(messagesContainer) {
        const conversationId = CookieUtils.get('shopAiConversationId');
        
        if (!conversationId) {
          console.log('No conversation ID found, nothing to reset');
          return;
        }

        // Show confirmation dialog
        if (!confirm('Are you sure you want to reset the chat? This will clear all conversation history.')) {
          return;
        }

        try {
          // Call the reset API
          const response = await fetch('https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/api/reset-chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              conversation_id: conversationId
            }),
            mode: 'cors'
          });

          console.log('Reset API response status:', response.status);
          console.log('Reset API response headers:', response.headers);

          if (response.ok) {
            const result = await response.json();
            console.log('Reset API response:', result);
            
            // Clear the messages container
            messagesContainer.innerHTML = '';
            
            // Show the welcome message and conversation starters
            ShopAIChat.showWelcomeWithWhatsAppChoice();
            
            console.log('Chat reset successfully');
          } else {
            const errorText = await response.text();
            console.error('Failed to reset chat:', response.status, response.statusText, errorText);
            alert(`Failed to reset chat (${response.status}): ${response.statusText}`);
          }
        } catch (error) {
          console.error('Error resetting chat:', error);
          alert(`Failed to reset chat: ${error.message}`);
        }
      },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function(text, sender, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', sender);

        if (sender === 'assistant') {
          messageElement.dataset.rawText = text;
          ShopAIChat.Formatting.formatMessageContent(messageElement);
          
          // Play notification sound for all assistant messages
          ShopAIChat.playNotificationSound();
        } else {
          messageElement.textContent = text;
        }

        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();

        return messageElement;
      },

      /**
       * Add a tool use message to the chat with expandable arguments
       * @param {string} toolMessage - Tool use message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addToolUse: function(toolMessage, messagesContainer) {
        // Parse the tool message to extract tool name and arguments
        const match = toolMessage.match(/Calling tool: (\w+) with arguments: (.+)/);
        if (!match) {
          // Fallback for unexpected format
          const toolUseElement = document.createElement('div');
          toolUseElement.classList.add('shop-ai-message', 'tool-use');
          toolUseElement.textContent = toolMessage;
          messagesContainer.appendChild(toolUseElement);
          ShopAIChat.UI.scrollToBottom();
          return;
        }

        const toolName = match[1];
        const argsString = match[2];

        // Create the main tool use element
        const toolUseElement = document.createElement('div');
        toolUseElement.classList.add('shop-ai-message', 'tool-use');

        // Create the header (always visible)
        const headerElement = document.createElement('div');
        headerElement.classList.add('shop-ai-tool-header');

        const toolText = document.createElement('span');
        toolText.classList.add('shop-ai-tool-text');
        toolText.textContent = `Calling tool: ${toolName}`;

        const toggleElement = document.createElement('span');
        toggleElement.classList.add('shop-ai-tool-toggle');
        toggleElement.textContent = '[+]';

        headerElement.appendChild(toolText);
        headerElement.appendChild(toggleElement);

        // Create the arguments section (initially hidden)
        const argsElement = document.createElement('div');
        argsElement.classList.add('shop-ai-tool-args');

        try {
          // Try to format JSON arguments nicely
          const parsedArgs = JSON.parse(argsString);
          argsElement.textContent = JSON.stringify(parsedArgs, null, 2);
        } catch (e) {
          // If not valid JSON, just show as-is
          argsElement.textContent = argsString;
        }

        // Add click handler to toggle arguments visibility
        headerElement.addEventListener('click', function() {
          const isExpanded = argsElement.classList.contains('expanded');
          if (isExpanded) {
            argsElement.classList.remove('expanded');
            toggleElement.textContent = '[+]';
          } else {
            argsElement.classList.add('expanded');
            toggleElement.textContent = '[-]';
          }
        });

        // Assemble the complete element
        toolUseElement.appendChild(headerElement);
        toolUseElement.appendChild(argsElement);

        messagesContainer.appendChild(toolUseElement);
        ShopAIChat.UI.scrollToBottom();
      },

      /**
       * Show a bot message in the chat
       * @param {string} text - Message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      showBotMessage: function(text, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', 'assistant');
        messageElement.dataset.rawText = text;
        ShopAIChat.Formatting.formatMessageContent(messageElement);
        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();
      }
    },

    /**
     * Text formatting and markdown handling
     */
    Formatting: {
      /**
       * Format message content with markdown and links
       * @param {HTMLElement} element - The element to format
       */
      formatMessageContent: function(element) {
        if (!element || !element.dataset.rawText) return;

        const rawText = element.dataset.rawText;

        // Process the text with various Markdown features
        let processedText = rawText;

        // Process Markdown links
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        processedText = processedText.replace(markdownLinkRegex, (match, text, url) => {
          // Check if it's an auth URL (broadened to any domain)
          if ((url.includes('/authentication') || url.includes('oauth/authorize'))) {
            // Store the auth URL in a global variable for later use - this avoids issues with onclick handlers
            window.shopAuthUrl = url;
            // Return a short link that will be handled by the document click handler
            return '<a href="#auth" class="shop-auth-trigger">' + (text && text.trim() ? text : 'Click here to authorize') + '</a>';
          }
          // If it's a checkout link, replace the text
          else if (url.includes('/cart') || url.includes('checkout')) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">click here to proceed to checkout</a>';
          } else {
            // For normal links, preserve the original text
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
          }
        });

        // Convert bare URLs to short, friendly links while avoiding replacements inside existing HTML
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        const formatBareUrl = (url) => {
          // Auth URLs → short trigger link
          if (url.includes('/authentication') || url.includes('oauth/authorize')) {
            window.shopAuthUrl = url;
            return '<a href="#auth" class="shop-auth-trigger">Click here to authorize</a>';
          }
          // Checkout/cart URLs → friendly text
          if (url.includes('/cart') || url.includes('checkout')) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">click here to proceed to checkout</a>';
          }
          // Otherwise show a shortened display (domain + truncated path)
          let display = 'link';
          try {
            const u = new URL(url);
            display = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '');
            if (display.length > 28) display = display.slice(0, 28) + '…';
          } catch (e) {}
          return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + display + '</a>';
        };
        processedText = processedText
          .split(/(<[^>]+>)/g)
          .map(part => part.startsWith('<') ? part : part.replace(urlRegex, (m) => formatBareUrl(m)))
          .join('');

        // Convert text to HTML with proper list handling
        processedText = this.convertMarkdownToHtml(processedText);

        // Apply the formatted HTML
        element.innerHTML = processedText;
      },

      /**
       * Convert Markdown text to HTML with list support
       * @param {string} text - Markdown text to convert
       * @returns {string} HTML content
       */
      convertMarkdownToHtml: function(text) {
        text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
        const lines = text.split('\n');
        let currentList = null;
        let listItems = [];
        let htmlContent = '';
        let startNumber = 1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const unorderedMatch = line.match(/^\s*([-*])\s+(.*)/);
          const orderedMatch = line.match(/^\s*(\d+)[\.)]\s+(.*)/);

          if (unorderedMatch) {
            if (currentList !== 'ul') {
              if (currentList === 'ol') {
                htmlContent += `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
                listItems = [];
              }
              currentList = 'ul';
            }
            listItems.push('<li>' + unorderedMatch[2] + '</li>');
          } else if (orderedMatch) {
            if (currentList !== 'ol') {
              if (currentList === 'ul') {
                htmlContent += '<ul>' + listItems.join('') + '</ul>';
                listItems = [];
              }
              currentList = 'ol';
              startNumber = parseInt(orderedMatch[1], 10);
            }
            listItems.push('<li>' + orderedMatch[2] + '</li>');
          } else {
            if (currentList) {
              htmlContent += currentList === 'ul'
                ? '<ul>' + listItems.join('') + '</ul>'
                : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
              listItems = [];
              currentList = null;
            }

            if (line.trim() === '') {
              htmlContent += '<br>';
            } else {
              htmlContent += '<p>' + line + '</p>';
            }
          }
        }

        if (currentList) {
          htmlContent += currentList === 'ul'
            ? '<ul>' + listItems.join('') + '</ul>'
            : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
        }

        htmlContent = htmlContent.replace(/<\/p><p>/g, '</p>\n<p>');
        return htmlContent;
      }
    },

    /**
     * API communication and data handling
     */
    API: {
      /**
       * Stream a response from the API
       * @param {string} userMessage - User's message text
       * @param {string} conversationId - Conversation ID for context
       * @param {HTMLElement} messagesContainer - The messages container
       */
      streamResponse: async function(userMessage, conversationId, messagesContainer) {
        let currentMessageElement = null;

        // Set streaming flag to prevent poll from adding duplicate messages
        console.log('[STREAM DEBUG] Starting stream, setting isStreaming = true');
        ShopAIChat.UI.isStreaming = true;

        try {
          const promptType = window.shopChatConfig?.promptType || "standardAssistant";
          // Prepare request body with customer ID if available
          const requestBody = JSON.stringify({
            message: userMessage,
            conversation_id: conversationId,
            prompt_type: promptType,
            shopify_customer_id: window.Shopify && window.Shopify.customer ? window.Shopify.customer.id : null
          });

          const streamUrl = 'https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/chat';
          const shopId = window.shopId;

          const response = await fetch(streamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
              'X-Shopify-Shop-Id': shopId
            },
            body: requestBody
          });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Create initial message element
          let messageElement = document.createElement('div');
          messageElement.classList.add('shop-ai-message', 'assistant');
          messageElement.textContent = '';
          messageElement.dataset.rawText = '';
          messagesContainer.appendChild(messageElement);
          currentMessageElement = messageElement;

          // Process the stream
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  this.handleStreamEvent(data, currentMessageElement, messagesContainer, userMessage,
                    (newElement) => { currentMessageElement = newElement; });
                } catch (e) {
                  console.error('Error parsing event data:', e, line);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error in streaming:', error);
          ShopAIChat.UI.removeTypingIndicator();
          ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.",
            'assistant', messagesContainer);
        } finally {
          // Clear streaming flag when done
          console.log('[STREAM DEBUG] Stream complete, setting isStreaming = false');
          ShopAIChat.UI.isStreaming = false;
        }
      },

      /**
       * Handle stream events from the API
       * @param {Object} data - Event data
       * @param {HTMLElement} currentMessageElement - Current message element being updated
       * @param {HTMLElement} messagesContainer - The messages container
       * @param {string} userMessage - The original user message
       * @param {Function} updateCurrentElement - Callback to update the current element reference
       */
      handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, updateCurrentElement) {
        switch (data.type) {
          case 'id':
            if (data.conversation_id) {
              CookieUtils.set('shopAiConversationId', data.conversation_id, 90);
            }
            break;

          case 'chunk':
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.dataset.rawText += data.chunk;
            currentMessageElement.textContent = currentMessageElement.dataset.rawText;
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'message_complete':
            ShopAIChat.UI.removeTypingIndicator();
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
            ShopAIChat.UI.scrollToBottom();
            // Play notification sound for completed streamed message
            ShopAIChat.playNotificationSound();
            // Update last message timestamp from database if available, otherwise use current time
            const newTimestamp = data.timestamp || new Date().toISOString();
            console.log('[STREAM DEBUG] message_complete received, setting lastMessageTimestamp to:', newTimestamp);
            ShopAIChat.UI.lastMessageTimestamp = newTimestamp;
            break;

          case 'end_turn':
            ShopAIChat.UI.removeTypingIndicator();
            break;

          case 'error':
            console.error('Stream error:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = "Sorry, I couldn't process your request. Please try again later.";
            break;

          case 'rate_limit_exceeded':
            console.error('Rate limit exceeded:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = "Sorry, our servers are currently busy. Please try again later.";
            break;

          case 'auth_required':
            // Save the last user message for resuming after authentication
            CookieUtils.set('shopAiLastMessage', userMessage || '', 1);
            
            // Display the authentication link to the user (short link text, no raw URL)
            if (data.authUrl) {
              try { window.shopAuthUrl = data.authUrl; } catch (e) {}
              const authMessage = `I need you to authorize access to your customer account to check your order status. Please click this link to authorize the app:\n\n<a href="#auth" class="shop-auth-trigger">Click here to authorize</a>\n\nOnce you've authorized the access, I'll be able to check your order status and provide you with all the details you need!`;
              ShopAIChat.Message.add(authMessage, 'assistant', messagesContainer);
            }
            break;

          case 'product_results':
            ShopAIChat.UI.displayProductResults(data.products);
            break;

          case 'tool_use':
            if (data.tool_use_message) {
              ShopAIChat.Message.addToolUse(data.tool_use_message, messagesContainer);
            }
            break;

          case 'new_message':
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
            ShopAIChat.UI.showTypingIndicator();

            // Create new message element for the next response
            const newMessageElement = document.createElement('div');
            newMessageElement.classList.add('shop-ai-message', 'assistant');
            newMessageElement.textContent = '';
            newMessageElement.dataset.rawText = '';
            messagesContainer.appendChild(newMessageElement);

            // Update the current element reference
            updateCurrentElement(newMessageElement);
            break;

          case 'content_block_complete':
            ShopAIChat.UI.showTypingIndicator();
            break;
        }
      },

      /**
       * Check for unread messages
       * @param {string} conversationId - Conversation ID
       * @param {Object} uiInstance - UI instance to update indicator
       */
      checkUnreadMessages: async function(conversationId, uiInstance) {
        try {
          const unreadUrl = `https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/api/unread-messages?conversation_id=${encodeURIComponent(conversationId)}`;
          
          const response = await fetch(unreadUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          if (response.ok) {
            const data = await response.json();
            const unreadCount = data.unread_count || 0;
            uiInstance.showUnreadIndicator(unreadCount);
          }
        } catch (error) {
          console.error('Error checking unread messages:', error);
        }
      },

      /**
       * Check for recent assistant messages (e.g., follow-ups)
       * @param {string} conversationId - Conversation ID
       * @param {string} sinceTimestamp - ISO timestamp of last check
       * @param {HTMLElement} messagesContainer - Messages container to append to
       * @returns {string|null} - Latest timestamp or null
       */
      checkRecentMessages: async function(conversationId, sinceTimestamp, messagesContainer) {
        try {
          const recentUrl = `https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/api/recent-messages?conversation_id=${encodeURIComponent(conversationId)}&since=${encodeURIComponent(sinceTimestamp)}`;
          
          const response = await fetch(recentUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          if (response.ok) {
            const data = await response.json();
            
            // Check if we're currently streaming - if so, don't add messages
            if (ShopAIChat.UI.isStreaming) {
              console.log('[POLL DEBUG] Skipping poll message addition: currently streaming');
              return sinceTimestamp;
            }
            
            // Add new messages to the chat
            if (data.messages && data.messages.length > 0) {
              console.log('[POLL DEBUG] Checking', data.messages.length, 'messages from poll');
              data.messages.forEach(message => {
                console.log('[POLL DEBUG] Message has id:', message.id);
                console.log('[POLL DEBUG] displayedMessageIds:', Array.from(ShopAIChat.UI.displayedMessageIds));
                
                // Skip if we've already displayed this message
                if (message.id && ShopAIChat.UI.displayedMessageIds.has(message.id)) {
                  console.log('[POLL DEBUG] Skipping duplicate message with id:', message.id);
                  return;
                }
                
                // Mark message as displayed
                if (message.id) {
                  ShopAIChat.UI.displayedMessageIds.add(message.id);
                  console.log('[POLL DEBUG] Added message id to displayedMessageIds:', message.id);
                }
                
                try {
                  const messageContents = JSON.parse(message.content);
                  for (const contentBlock of messageContents) {
                    if (contentBlock.type === 'text') {
                      console.log('[POLL DEBUG] Adding message:', contentBlock.text.substring(0, 50) + '...');
                      ShopAIChat.Message.add(contentBlock.text, 'assistant', messagesContainer);
                    }
                  }
                } catch (e) {
                  console.log('[POLL DEBUG] Adding message (fallback):', message.content.substring(0, 50) + '...');
                  ShopAIChat.Message.add(message.content, 'assistant', messagesContainer);
                }
              });
              
              ShopAIChat.UI.scrollToBottom();
            }
            
            return data.latestTimestamp;
          }
        } catch (error) {
          console.error('Error checking recent messages:', error);
        }
        
        return sinceTimestamp;
      },

      /**
       * Fetch chat history from the server
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      fetchChatHistory: async function(conversationId, messagesContainer) {
        try {
          // Show a loading message
          const loadingMessage = document.createElement('div');
          loadingMessage.classList.add('shop-ai-message', 'assistant');
          loadingMessage.textContent = "Loading conversation history...";
          messagesContainer.appendChild(loadingMessage);

          // Fetch history from the server
          const historyUrl = `https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/chat?history=true&conversation_id=${encodeURIComponent(conversationId)}`;
          console.log('Fetching history from:', historyUrl);

          const response = await fetch(historyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          if (!response.ok) {
            console.error('History fetch failed:', response.status, response.statusText);
            throw new Error('Failed to fetch chat history: ' + response.status);
          }

          const data = await response.json();

          // Remove loading message
          messagesContainer.removeChild(loadingMessage);

          // No messages, show welcome message with conversation starters
          if (!data.messages || data.messages.length === 0) {
            ShopAIChat.showWelcomeWithWhatsAppChoice();
            return;
          }

          // Add messages to the UI - filter out tool results
          data.messages.forEach(message => {
            // Track message IDs to prevent duplicates from polling
            if (message.id) {
              ShopAIChat.UI.displayedMessageIds.add(message.id);
            }
            
            try {
              const messageContents = JSON.parse(message.content);
              for (const contentBlock of messageContents) {
                if (contentBlock.type === 'text') {
                  ShopAIChat.Message.add(contentBlock.text, message.role, messagesContainer);
                }
              }
            } catch (e) {
              ShopAIChat.Message.add(message.content, message.role, messagesContainer);
            }
          });

          // Set the last message timestamp for polling recent messages
          if (data.messages.length > 0) {
            const lastMessage = data.messages[data.messages.length - 1];
            ShopAIChat.UI.lastMessageTimestamp = lastMessage.createdAt;
          }

          // Scroll to bottom
          ShopAIChat.UI.scrollToBottom();

        } catch (error) {
          console.error('Error fetching chat history:', error);

          // Remove loading message if it exists
          const loadingMessage = messagesContainer.querySelector('.shop-ai-message.assistant');
          if (loadingMessage && loadingMessage.textContent === "Loading conversation history...") {
            messagesContainer.removeChild(loadingMessage);
          }

          // Show welcome message with conversation starters on error
          ShopAIChat.showWelcomeWithWhatsAppChoice();

          // Clear the conversation ID since we couldn't fetch this conversation
          CookieUtils.delete('shopAiConversationId');
        }
      }
    },

    /**
     * Authentication-related functionality
     */
    Auth: {
      /**
       * Opens an authentication popup window
       * @param {string|HTMLElement} authUrlOrElement - The auth URL or link element that was clicked
       */
      openAuthPopup: function(authUrlOrElement) {
        let authUrl;
        if (typeof authUrlOrElement === 'string') {
          // If a string URL was passed directly
          authUrl = authUrlOrElement;
        } else {
          // If an element was passed
          authUrl = authUrlOrElement.getAttribute('data-auth-url');
          if (!authUrl) {
            console.error('No auth URL found in element');
            return;
          }
        }

        // Open the popup window centered in the screen
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          'ShopifyAuth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        // Focus the popup window
        if (popup) {
          popup.focus();
        } else {
          // If popup was blocked, show a message
          alert('Please allow popups for this site to authenticate with Shopify.');
        }

        // Start polling for token availability
        const conversationId = CookieUtils.get('shopAiConversationId');
        if (conversationId) {
          const messagesContainer = document.querySelector('.shop-ai-chat-messages');

          // Add a message to indicate authentication is in progress
          ShopAIChat.Message.add("Authentication in progress. Please complete the process in the popup window.",
            'assistant', messagesContainer);

          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      /**
       * Start polling for token availability
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      startTokenPolling: function(conversationId, messagesContainer) {
        if (!conversationId) return;

        console.log('Starting token polling for conversation:', conversationId);
        const pollingId = 'polling_' + Date.now();
        CookieUtils.set('shopAiTokenPollingId', pollingId, 1);

        let attemptCount = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (CookieUtils.get('shopAiTokenPollingId') !== pollingId) {
            console.log('Another polling session has started, stopping this one');
            return;
          }

          if (attemptCount >= maxAttempts) {
            console.log('Max polling attempts reached, stopping');
            return;
          }

          attemptCount++;

          try {
            const tokenUrl = 'https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/auth/token-status?conversation_id=' +
              encodeURIComponent(conversationId);
            const response = await fetch(tokenUrl);

            if (!response.ok) {
              throw new Error('Token status check failed: ' + response.status);
            }

            const data = await response.json();

            if (data.status === 'authorized') {
              console.log('Token available, resuming conversation');
              const message = CookieUtils.get('shopAiLastMessage');

              if (message) {
                CookieUtils.delete('shopAiLastMessage');
                setTimeout(() => {
                  ShopAIChat.Message.add("Authorization successful! I'm now continuing with your request.",
                    'assistant', messagesContainer);
                  ShopAIChat.API.streamResponse(message, conversationId, messagesContainer);
                  ShopAIChat.UI.showTypingIndicator();
                }, 500);
              }

              CookieUtils.delete('shopAiTokenPollingId');
              return;
            }

            console.log('Token not available yet, polling again in 10s');
            setTimeout(poll, 10000);
          } catch (error) {
            console.error('Error polling for token status:', error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      }
    },

    /**
     * Product-related functionality
     */
    Product: {
      /**
       * Create a product card element
       * @param {Object} product - Product data
       * @returns {HTMLElement} Product card element
       */
      createCard: function(product) {
        const card = document.createElement('div');
        card.classList.add('shop-ai-product-card');

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('shop-ai-product-image');

        // Add product image or placeholder
        const image = document.createElement('img');
        image.src = product.image_url || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        image.alt = product.title;
        image.onerror = function() {
          // If image fails to load, use a fallback placeholder
          this.src = 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        };
        imageContainer.appendChild(image);
        card.appendChild(imageContainer);

        // Add product info
        const info = document.createElement('div');
        info.classList.add('shop-ai-product-info');

        // Add product title
        const title = document.createElement('h3');
        title.classList.add('shop-ai-product-title');
        title.textContent = product.title;

        // If product has a URL, make the title a link
        if (product.url) {
          const titleLink = document.createElement('a');
          titleLink.href = product.url;
          titleLink.target = '_blank';
          titleLink.textContent = product.title;
          title.textContent = '';
          title.appendChild(titleLink);
        }

        info.appendChild(title);

        // Add product price
        const price = document.createElement('p');
        price.classList.add('shop-ai-product-price');
        price.textContent = product.price;
        info.appendChild(price);

        // Add add-to-cart button
        const button = document.createElement('button');
        button.classList.add('shop-ai-add-to-cart');
        button.textContent = 'Add to Cart';
        button.dataset.productId = product.id;

        // Add click handler for the button
        button.addEventListener('click', function() {
          // Send message to add this product to cart
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = `Add ${product.title} to my cart`;
            // Trigger a click on the send button
            const sendButton = document.querySelector('.shop-ai-chat-send');
            if (sendButton) {
              sendButton.click();
            }
          }
        });

        info.appendChild(button);
        card.appendChild(info);

        return card;
      }
    },

    /**
     * Initialize the chat application
     */
    init: function() {
      // Initialize UI
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) return;

      this.UI.init(container);

      // Show WhatsApp banner at all times
      const whatsappBanner = document.getElementById('whatsapp-banner');
      if (whatsappBanner) {
        whatsappBanner.style.display = 'flex';
      }

      // Add WhatsApp banner button handler
      const whatsappBannerBtn = document.getElementById('whatsapp-banner-btn');
      if (whatsappBannerBtn) {
        whatsappBannerBtn.addEventListener('click', () => {
          this.showWhatsAppInput();
        });
      }

      // Check for existing conversation (prioritize Shopify customer ID for cross-device sync)
      let conversationId = null;
      
      // Enhanced customer detection for cross-device sync (including new customer account system)
      let customerId = null;
      
      // Try legacy Shopify customer detection first
      if (window.Shopify && window.Shopify.customer && window.Shopify.customer.id) {
        customerId = window.Shopify.customer.id;
        console.log('Customer ID detected via legacy window.Shopify.customer:', customerId);
      } else if (window.Shopify && window.Shopify.customerId) {
        customerId = window.Shopify.customerId;
        console.log('Customer ID detected via window.Shopify.customerId:', customerId);
      } else {
        // Check for new customer account system methods
        // Method 1: Check for customer ID in meta tags (new customer account system)
        const customerMeta = document.querySelector('meta[name="customer-id"]');
        if (customerMeta) {
          customerId = customerMeta.getAttribute('content');
          console.log('Customer ID detected via meta tag:', customerId);
        }
        
        // Method 2: Check for customer ID in data attributes (new customer account system)
        if (!customerId) {
          const customerElement = document.querySelector('[data-customer-id]');
          if (customerElement) {
            customerId = customerElement.getAttribute('data-customer-id');
            console.log('Customer ID detected via data attribute:', customerId);
          }
        }
        
        // Method 3: Check for customer ID in window object (new customer account system)
        if (!customerId && window.customerId) {
          customerId = window.customerId;
          console.log('Customer ID detected via window.customerId:', customerId);
        }
        
        // Method 4: Check for customer ID in Shopify object properties (new customer account system)
        if (!customerId && window.Shopify) {
          // Try different possible properties for new customer account system
          const possibleProps = ['customer_id', 'customerId', 'customer.id'];
          for (const prop of possibleProps) {
            const value = window.Shopify[prop];
            if (value && typeof value === 'string' && /^\d+$/.test(value)) {
              customerId = value;
              console.log(`Customer ID detected via window.Shopify.${prop}:`, customerId);
              break;
            }
          }
        }
        
        // Method 5: Check for customer ID in the page URL
        if (!customerId) {
          const urlMatch = window.location.href.match(/customer_id[=\/]([0-9]+)/i);
          if (urlMatch) {
            customerId = urlMatch[1];
            console.log('Customer ID detected via URL:', customerId);
          }
        }
        
        // Method 6: Check for customer ID in localStorage or sessionStorage
        if (!customerId) {
          const storedCustomerId = localStorage.getItem('shopify_customer_id') || sessionStorage.getItem('shopify_customer_id');
          if (storedCustomerId) {
            customerId = storedCustomerId;
            console.log('Customer ID detected via storage:', customerId);
          }
        }
      }
      
      if (customerId) {
        conversationId = `web_customer_${customerId}`;
        CookieUtils.set('shopAiConversationId', conversationId, 90);
        console.log('Using customer-based conversation ID for cross-device sync:', conversationId);
      } else {
        // For non-logged-in users, use existing cookie or generate new anonymous ID
        conversationId = CookieUtils.get('shopAiConversationId');
        if (!conversationId) {
          conversationId = `web_anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          CookieUtils.set('shopAiConversationId', conversationId, 90);
        }
        console.log('Using anonymous conversation ID:', conversationId);
        console.log('Customer detection failed. Available Shopify objects:', {
          hasShopify: !!window.Shopify,
          hasCustomer: !!(window.Shopify && window.Shopify.customer),
          hasCustomerId: !!(window.Shopify && window.Shopify.customer && window.Shopify.customer.id),
          hasCustomerIdDirect: !!(window.Shopify && window.Shopify.customerId),
          shopifyKeys: window.Shopify ? Object.keys(window.Shopify) : [],
          windowCustomerId: window.customerId,
          metaTags: Array.from(document.querySelectorAll('meta[name*="customer"]')).map(m => ({ name: m.name, content: m.content })),
          dataAttributes: Array.from(document.querySelectorAll('[data-customer-id]')).map(el => el.getAttribute('data-customer-id'))
        });
      }

      if (conversationId) {
        // Fetch conversation history
        this.API.fetchChatHistory(conversationId, this.UI.elements.messagesContainer);
      } else {
        // No previous conversation, show welcome message with WhatsApp choice
        this.showWelcomeWithWhatsAppChoice();
      }

      // Set up periodic unread message checking (every 30 seconds)
      setInterval(() => {
        this.UI.checkUnreadMessages();
      }, 30000);

      // Set up periodic recent message checking (every 10 seconds) when chat is open
      setInterval(() => {
        this.UI.checkRecentMessages();
      }, 10000);

      // Set up customer ID detection retry for cross-device sync
      this.setupCustomerIdDetectionRetry();
    },

    /**
     * Set up customer ID detection retry for cross-device sync
     */
    setupCustomerIdDetectionRetry: function() {
      // Retry customer ID detection after a delay in case Shopify object loads later
      setTimeout(() => {
        const currentConversationId = CookieUtils.get('shopAiConversationId');
        
        // If we're using an anonymous ID, try to detect customer ID again
        if (currentConversationId && currentConversationId.startsWith('web_anon_')) {
          let customerId = null;
          
          // Try multiple methods to detect customer ID (including new customer account system)
          if (window.Shopify && window.Shopify.customer && window.Shopify.customer.id) {
            customerId = window.Shopify.customer.id;
          } else if (window.Shopify && window.Shopify.customerId) {
            customerId = window.Shopify.customerId;
          } else {
            // Check for new customer account system methods
            // Method 1: Check for customer ID in meta tags
            const customerMeta = document.querySelector('meta[name="customer-id"]');
            if (customerMeta) {
              customerId = customerMeta.getAttribute('content');
            }
            
            // Method 2: Check for customer ID in data attributes
            if (!customerId) {
              const customerElement = document.querySelector('[data-customer-id]');
              if (customerElement) {
                customerId = customerElement.getAttribute('data-customer-id');
              }
            }
            
            // Method 3: Check for customer ID in window object
            if (!customerId && window.customerId) {
              customerId = window.customerId;
            }
            
            // Method 4: Check for customer ID in Shopify object properties
            if (!customerId && window.Shopify) {
              const possibleProps = ['customer_id', 'customerId', 'customer.id'];
              for (const prop of possibleProps) {
                const value = window.Shopify[prop];
                if (value && typeof value === 'string' && /^\d+$/.test(value)) {
                  customerId = value;
                  break;
                }
              }
            }
            
            // Method 5: Check for customer ID in the page URL
            if (!customerId) {
              const urlMatch = window.location.href.match(/customer_id[=\/]([0-9]+)/i);
              if (urlMatch) {
                customerId = urlMatch[1];
              }
            }
            
            // Method 6: Check for customer ID in localStorage or sessionStorage
            if (!customerId) {
              const storedCustomerId = localStorage.getItem('shopify_customer_id') || sessionStorage.getItem('shopify_customer_id');
              if (storedCustomerId) {
                customerId = storedCustomerId;
              }
            }
          }
          
          if (customerId) {
            const newConversationId = `web_customer_${customerId}`;
            CookieUtils.set('shopAiConversationId', newConversationId, 90);
            console.log('Customer ID detected on retry, switching to customer-based conversation:', newConversationId);
            
            // Reload chat history with the new conversation ID
            this.API.fetchChatHistory(newConversationId, this.UI.elements.messagesContainer);
          }
        }
      }, 2000); // Wait 2 seconds for Shopify objects to load
    },

    /**
     * Show welcome message with conversation starter buttons
     */
    showWelcomeWithWhatsAppChoice: function() {
      const { messagesContainer } = this.UI.elements;

      // Create the welcome message
      const welcomeMessage = document.createElement('div');
      welcomeMessage.classList.add('shop-ai-message', 'assistant');
      welcomeMessage.innerHTML = `
        <div class="shop-ai-message-content">
          👋 Welcome to our store! I'm your AI shopping assistant and I'm here to help you find exactly what you're looking for.<br><br>
          <strong>What would you like to do today?</strong>
        </div>
      `;
      messagesContainer.appendChild(welcomeMessage);

      // Create conversation starter buttons
      const choiceMessage = document.createElement('div');
      choiceMessage.classList.add('shop-ai-message', 'assistant', 'choice-buttons');
      choiceMessage.innerHTML = `
        <div class="shop-ai-conversation-starters">
          <button class="shop-ai-starter-btn" data-message="I'm looking for products">🛍️ Browse Products</button>
          <button class="shop-ai-starter-btn" data-message="What are your bestsellers?">⭐ Best Sellers</button>
          <button class="shop-ai-starter-btn" data-message="What's the status of my order?">📦 Order Help</button>
        </div>
      `;
      messagesContainer.appendChild(choiceMessage);

      // Add event listeners for the conversation starter buttons
      const buttons = choiceMessage.querySelectorAll('.shop-ai-starter-btn');
      buttons.forEach(button => {
        button.addEventListener('click', async function() {
          const message = this.dataset.message;
          
          // Disable all buttons to prevent multiple clicks
          buttons.forEach(btn => btn.disabled = true);
          
          // Change button text to show it's processing
          this.textContent = 'Processing...';
          
          // For all conversation starters, remove the buttons and send the message
          choiceMessage.remove();
          
          // Send the selected message
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = message;
            const sendButton = document.querySelector('.shop-ai-chat-send');
            if (sendButton) {
              sendButton.click();
            }
          }
        });
      });

      // Scroll to bottom
      this.UI.scrollToBottom();
    },

    /**
     * Show WhatsApp input form
     */
    showWhatsAppInput: function() {
      const { messagesContainer } = this.UI.elements;
      const self = this; // Store reference to ShopAIChat object

      // Create WhatsApp input message
      const whatsappMessage = document.createElement('div');
      whatsappMessage.classList.add('shop-ai-message', 'assistant');
      whatsappMessage.innerHTML = `
        <div class="shop-ai-message-content">
          Please enter your WhatsApp number:
        </div>
      `;
      messagesContainer.appendChild(whatsappMessage);

      // Create input form
      const inputMessage = document.createElement('div');
      inputMessage.classList.add('shop-ai-message', 'user', 'whatsapp-input');
      inputMessage.innerHTML = `
        <div class="shop-ai-whatsapp-input">
          <input type="text" id="whatsapp-number-input" placeholder="07890123456" class="shop-ai-phone-input">
          <button id="send-whatsapp-invite-btn" class="shop-ai-choice-btn">Send Invite</button>
        </div>
      `;
      messagesContainer.appendChild(inputMessage);

      // Focus on the phone input
      setTimeout(() => {
        const phoneInput = document.getElementById('whatsapp-number-input');
        if (phoneInput) {
          phoneInput.focus();
        }
      }, 100);

      // Handle WhatsApp invite
      document.getElementById('send-whatsapp-invite-btn').addEventListener('click', async function() {
        const phoneInput = document.getElementById('whatsapp-number-input');
        let phoneNumber = phoneInput.value.trim();
        
        if (!phoneNumber) {
          alert('Please enter a valid phone number.');
          return;
        }
        
        // Format phone number - add UK country code if missing
        phoneNumber = ShopAIChat.formatPhoneNumber(phoneNumber);
        
        if (!phoneNumber) {
          alert('Please enter a valid phone number.');
          return;
        }
        
        // Show the formatted number to the user
        phoneInput.value = phoneNumber;
        phoneInput.style.backgroundColor = '#f0f9ff';
        phoneInput.style.borderColor = '#3b82f6';
        
        // Change button text
        this.textContent = 'Sending...';
        this.disabled = true;
        
        try {
          // Call backend to send WhatsApp invite
          const res = await fetch('https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/api/send-whatsapp-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
          });
          
          const data = await res.json();
          
          if (res.ok) {
            // Remove the input form
            whatsappMessage.remove();
            inputMessage.remove();
            
            // Add bot message with success
            const successMessage = document.createElement('div');
            successMessage.classList.add('shop-ai-message', 'assistant');
            successMessage.innerHTML = `
              <div class="shop-ai-message-content">
                ✅ We've sent you a message on WhatsApp! Please check your phone and reply to continue chatting.
              </div>
            `;
            messagesContainer.appendChild(successMessage);
          } else {
            // Remove the input form
            whatsappMessage.remove();
            inputMessage.remove();
            
            // Add bot message with error
            const errorMessage = document.createElement('div');
            errorMessage.classList.add('shop-ai-message', 'assistant');
            errorMessage.innerHTML = `
              <div class="shop-ai-message-content">
                ❌ Sorry, there was a problem sending the WhatsApp invite. ${data.details || 'Please try again.'}
              </div>
            `;
            messagesContainer.appendChild(errorMessage);
          }
        } catch (error) {
          // Remove the input form
          whatsappMessage.remove();
          inputMessage.remove();
          
          // Add bot message with error
          const errorMessage = document.createElement('div');
          errorMessage.classList.add('shop-ai-message', 'assistant');
          errorMessage.innerHTML = `
            <div class="shop-ai-message-content">
              ❌ Sorry, there was a problem sending the WhatsApp invite. Please try again.
            </div>
          `;
          messagesContainer.appendChild(errorMessage);
        }
        
        // Scroll to bottom
        self.UI.scrollToBottom();
      });
    },


    /**
     * Format phone number to include country code
     * @param {string} phoneNumber - The phone number to format
     * @returns {string} Formatted phone number or null if invalid
     */
    formatPhoneNumber: function(phoneNumber) {
      // Remove all non-digit characters
      const digits = phoneNumber.replace(/\D/g, '');
      
      // If it already starts with +, return as is
      if (phoneNumber.startsWith('+')) {
        return phoneNumber;
      }
      
      // If it starts with 00, convert to +
      if (phoneNumber.startsWith('00')) {
        return '+' + phoneNumber.substring(2);
      }
      
      // UK number patterns
      if (digits.length === 11 && digits.startsWith('0')) {
        // UK mobile: 07xxxxxxxxx -> +447xxxxxxxxx
        return '+44' + digits.substring(1);
      }
      
      if (digits.length === 10 && digits.startsWith('7')) {
        // UK mobile without leading 0: 7xxxxxxxxx -> +447xxxxxxxxx
        return '+44' + digits;
      }
      
      if (digits.length === 11 && digits.startsWith('44')) {
        // Already has country code: 44xxxxxxxxx -> +44xxxxxxxxx
        return '+' + digits;
      }
      
      // If it's 11 digits and doesn't match UK patterns, assume it's already international
      if (digits.length === 11) {
        return '+' + digits;
      }
      
      // If it's 10 digits, assume it's a UK number without country code
      if (digits.length === 10) {
        return '+44' + digits;
      }
      
      // Invalid format
      return null;
    }
  };

  // Add this function near the top-level of the IIFE
  function showInitialChannelChoice() {
    const { messagesContainer } = ShopAIChat.UI.elements;

    // Clear previous messages (optional)
    messagesContainer.innerHTML = '';

    // Create the initial message
    const msgDiv = document.createElement('div');
    msgDiv.className = 'shop-ai-message shop-ai-message-bot';
    msgDiv.innerHTML = `
      <div class="shop-ai-message-content">
        👋 Hi there! How can I help you today?<br>
        <strong>Would you like to chat here or on WhatsApp?</strong>
        <div style="margin-top: 10px;">
          <button id="chat-here-btn" class="shop-ai-choice-btn">Chat here</button>
          <button id="chat-whatsapp-btn" class="shop-ai-choice-btn">Chat on WhatsApp</button>
        </div>
      </div>
    `;
    messagesContainer.appendChild(msgDiv);

    // Add event listeners for the buttons
    document.getElementById('chat-here-btn').onclick = function() {
      // Remove the choice message and continue as normal
      msgDiv.remove();
      ShopAIChat.Message.showBotMessage("Great! How can I assist you today?");
    };

    document.getElementById('chat-whatsapp-btn').onclick = function() {
      // Replace with phone number input
      msgDiv.innerHTML = `
        <div class="shop-ai-message-content">
          Please enter your WhatsApp number (with country code):<br>
          <input type="text" id="whatsapp-number-input" placeholder="+1234567890" style="margin-top:5px;">
          <button id="send-whatsapp-invite-btn" class="shop-ai-choice-btn" style="margin-left:5px;">Send Invite</button>
        </div>
      `;
      document.getElementById('send-whatsapp-invite-btn').onclick = async function() {
        const phoneNumber = document.getElementById('whatsapp-number-input').value.trim();
        if (!phoneNumber) {
          alert('Please enter a valid phone number.');
          return;
        }
        try {
          // Call backend to send WhatsApp invite
          const res = await fetch('https://shop-chat-agent-whatsapp-j6ftf.ondigitalocean.app/api/send-whatsapp-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
          });
          const data = await res.json();
          
          if (res.ok) {
            msgDiv.innerHTML = `<div class=\"shop-ai-message-content\">✅ We've sent you a message on WhatsApp! Please check your phone and reply to continue chatting.</div>`;
          } else {
            msgDiv.innerHTML = `<div class=\"shop-ai-message-content\">❌ Sorry, there was a problem sending the WhatsApp invite. ${data.details || 'Please try again.'}</div>`;
          }
        } catch (error) {
          msgDiv.innerHTML = `<div class=\"shop-ai-message-content\">❌ Network error. Please check your connection and try again.</div>`;
        }
      };
    };
  }

  // Initialize the application when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    ShopAIChat.init();
  });
})();
