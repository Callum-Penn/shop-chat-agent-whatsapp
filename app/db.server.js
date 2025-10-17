import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

/**
 * Store a code verifier for PKCE authentication
 * @param {string} state - The state parameter used in OAuth flow
 * @param {string} verifier - The code verifier to store
 * @returns {Promise<Object>} - The saved code verifier object
 */
export async function storeCodeVerifier(state, verifier) {
  // Calculate expiration date (10 minutes from now)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  try {
    return await prisma.codeVerifier.create({
      data: {
        id: `cv_${Date.now()}`,
        state,
        verifier,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error storing code verifier:', error);
    throw error;
  }
}

/**
 * Get a code verifier by state parameter
 * @param {string} state - The state parameter used in OAuth flow
 * @returns {Promise<Object|null>} - The code verifier object or null if not found
 */
export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: {
        state,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (verifier) {
      // Delete it after retrieval to prevent reuse
      await prisma.codeVerifier.delete({
        where: {
          id: verifier.id
        }
      });
    }

    return verifier;
  } catch (error) {
    console.error('Error retrieving code verifier:', error);
    return null;
  }
}

/**
 * Store a customer access token in the database
 * @param {string} conversationId - The conversation ID to associate with the token
 * @param {string} accessToken - The access token to store
 * @param {Date} expiresAt - When the token expires
 * @returns {Promise<Object>} - The saved customer token
 */
export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  try {
    // Check if a token already exists for this conversation
    const existingToken = await prisma.customerToken.findFirst({
      where: { conversationId }
    });

    if (existingToken) {
      // Update existing token
      return await prisma.customerToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken,
          expiresAt,
          updatedAt: new Date()
        }
      });
    }

    // Create a new token record
    return await prisma.customerToken.create({
      data: {
        id: `ct_${Date.now()}`,
        conversationId,
        accessToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer token:', error);
    throw error;
  }
}

/**
 * Get a customer access token by conversation ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer token or null if not found/expired
 */
export async function getCustomerToken(conversationId) {
  try {
    const token = await prisma.customerToken.findFirst({
      where: {
        conversationId,
        expiresAt: {
          gt: new Date() // Only return non-expired tokens
        }
      }
    });

    return token;
  } catch (error) {
    console.error('Error retrieving customer token:', error);
    return null;
  }
}

/**
 * Create or update a conversation in the database
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} - The created or updated conversation
 */
export async function createOrUpdateConversation(conversationId) {
  try {
    const existingConversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (existingConversation) {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date()
        }
      });
    }

    return await prisma.conversation.create({
      data: {
        id: conversationId
      }
    });
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

/**
 * Save a message to the database
 * @param {string} conversationId - The conversation ID
 * @param {string} role - The message role (user or assistant)
 * @param {string} content - The message content
 * @returns {Promise<Object>} - The saved message
 */
export async function saveMessage(conversationId, role, content) {
  try {
    // Ensure the conversation exists
    await createOrUpdateConversation(conversationId);

    // Create the message
    return await prisma.message.create({
      data: {
        conversationId,
        role,
        content
      }
    });
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation ID
 * @param {number} limit - Maximum number of messages to retrieve (default: 10)
 * @returns {Promise<Array>} - Array of messages in the conversation
 */
export async function getConversationHistory(conversationId, limit = 10) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' }, // Get most recent first
      take: limit // Limit the number of messages
    });

    // Return in chronological order (oldest first)
    return messages.reverse();
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

/**
 * Store customer account URL for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} url - The customer account URL
 * @returns {Promise<Object>} - The saved URL object
 */
export async function storeCustomerAccountUrl(conversationId, url) {
  try {
    return await prisma.customerAccountUrl.upsert({
      where: { conversationId },
      update: {
        url,
        updatedAt: new Date()
      },
      create: {
        conversationId,
        url,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer account URL:', error);
    throw error;
  }
}

/**
 * Get customer account URL for a conversation
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string|null>} - The customer account URL or null if not found
 */
export async function getCustomerAccountUrl(conversationId) {
  try {
    const record = await prisma.customerAccountUrl.findUnique({
      where: { conversationId }
    });

    return record?.url || null;
  } catch (error) {
    console.error('Error retrieving customer account URL:', error);
    return null;
  }
}

/**
 * Clean up old messages to prevent database bloat
 * @param {string} conversationId - The conversation ID
 * @param {number} keepCount - Number of recent messages to keep (default: 10)
 * @returns {Promise<number>} - Number of messages deleted
 */
export async function cleanupOldMessages(conversationId, keepCount = 10) {
  try {
    // Get total message count for this conversation
    const totalMessages = await prisma.message.count({
      where: { conversationId }
    });

    // If we have more messages than we want to keep, delete the oldest ones
    if (totalMessages > keepCount) {
      const messagesToDelete = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: totalMessages - keepCount,
        select: { id: true }
      });

      if (messagesToDelete.length > 0) {
        await prisma.message.deleteMany({
          where: {
            id: { in: messagesToDelete.map(m => m.id) }
          }
        });
        
        console.log(`Cleaned up ${messagesToDelete.length} old messages for conversation ${conversationId}`);
        return messagesToDelete.length;
      }
    }

    return 0;
  } catch (error) {
    console.error('Error cleaning up old messages:', error);
    return 0;
  }
}

// ========================================
// USER MANAGEMENT FUNCTIONS
// ========================================

/**
 * Create or get a user by their identifier
 * @param {Object} params - User identification parameters
 * @param {string} params.type - User type: "web", "whatsapp", "web_customer"
 * @param {string} [params.shopifyCustomerId] - Shopify customer ID
 * @param {string} [params.phoneNumber] - Phone number for WhatsApp users
 * @param {string} [params.email] - Email address
 * @param {string} [params.name] - User name
 * @returns {Promise<Object>} - The user object
 */
export async function createOrGetUser({ type, shopifyCustomerId, phoneNumber, email, name }) {
  try {
    // Build where clause based on available identifiers
    const whereClause = {};
    
    if (shopifyCustomerId) {
      whereClause.shopifyCustomerId = shopifyCustomerId;
    } else if (phoneNumber) {
      whereClause.phoneNumber = phoneNumber;
    } else if (email) {
      whereClause.email = email;
    }

    // Try to find existing user
    if (Object.keys(whereClause).length > 0) {
      const existingUser = await prisma.user.findFirst({
        where: whereClause
      });

      if (existingUser) {
        // Update last seen timestamp
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { lastSeenAt: new Date() }
        });
        return existingUser;
      }
    }

    // Create new user
    const userData = {
      type,
      lastSeenAt: new Date()
    };

    if (shopifyCustomerId) userData.shopifyCustomerId = shopifyCustomerId;
    if (phoneNumber) userData.phoneNumber = phoneNumber;
    if (email) userData.email = email;
    if (name) userData.name = name;

    return await prisma.user.create({
      data: userData
    });
  } catch (error) {
    console.error('Error creating/getting user:', error);
    throw error;
  }
}

/**
 * Update user information
 * @param {string} userId - User ID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} - Updated user object
 */
export async function updateUser(userId, data) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserById(userId) {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      include: {
        conversations: {
          where: { archived: false },
          orderBy: { updatedAt: 'desc' },
          take: 5
        }
      }
    });
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}

/**
 * Link a conversation to a user
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID
 * @param {string} channel - Communication channel ("web" or "whatsapp")
 * @returns {Promise<Object>} - Updated conversation
 */
export async function linkConversationToUser(conversationId, userId, channel = 'web') {
  try {
    return await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        userId,
        channel,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error linking conversation to user:', error);
    throw error;
  }
}

/**
 * Create a new conversation with user link
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID
 * @param {string} channel - Communication channel ("web" or "whatsapp")
 * @returns {Promise<Object>} - Created conversation
 */
export async function createConversationWithUser(conversationId, userId, channel = 'web') {
  try {
    return await prisma.conversation.create({
      data: {
        id: conversationId,
        userId,
        channel
      }
    });
  } catch (error) {
    console.error('Error creating conversation with user:', error);
    throw error;
  }
}

// ========================================
// CONVERSATION ARCHIVING FUNCTIONS
// ========================================

/**
 * Archive old inactive conversations
 * @param {number} daysInactive - Number of days of inactivity before archiving (default: 30)
 * @returns {Promise<number>} - Number of conversations archived
 */
export async function archiveInactiveConversations(daysInactive = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

    const result = await prisma.conversation.updateMany({
      where: {
        updatedAt: { lt: cutoffDate },
        archived: false
      },
      data: {
        archived: true,
        updatedAt: new Date()
      }
    });

    console.log(`Archived ${result.count} inactive conversations`);
    return result.count;
  } catch (error) {
    console.error('Error archiving inactive conversations:', error);
    return 0;
  }
}

/**
 * Archive a specific conversation
 * @param {string} conversationId - Conversation ID to archive
 * @returns {Promise<Object>} - Archived conversation
 */
export async function archiveConversation(conversationId) {
  try {
    return await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        archived: true,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error archiving conversation:', error);
    throw error;
  }
}

/**
 * Unarchive a conversation
 * @param {string} conversationId - Conversation ID to unarchive
 * @returns {Promise<Object>} - Unarchived conversation
 */
export async function unarchiveConversation(conversationId) {
  try {
    return await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        archived: false,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error unarchiving conversation:', error);
    throw error;
  }
}

/**
 * Delete old archived conversations and their messages
 * @param {number} daysArchived - Delete conversations archived for this many days (default: 90)
 * @returns {Promise<number>} - Number of conversations deleted
 */
export async function deleteOldArchivedConversations(daysArchived = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysArchived);

    // Get conversations to delete
    const conversationsToDelete = await prisma.conversation.findMany({
      where: {
        archived: true,
        updatedAt: { lt: cutoffDate }
      },
      select: { id: true }
    });

    if (conversationsToDelete.length === 0) {
      return 0;
    }

    const conversationIds = conversationsToDelete.map(c => c.id);

    // Delete associated messages first (due to foreign key)
    await prisma.message.deleteMany({
      where: {
        conversationId: { in: conversationIds }
      }
    });

    // Delete conversations
    const result = await prisma.conversation.deleteMany({
      where: {
        id: { in: conversationIds }
      }
    });

    console.log(`Deleted ${result.count} old archived conversations`);
    return result.count;
  } catch (error) {
    console.error('Error deleting old archived conversations:', error);
    return 0;
  }
}

/**
 * Get conversation with user information
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Object|null>} - Conversation with user data
 */
export async function getConversationWithUser(conversationId) {
  try {
    return await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });
  } catch (error) {
    console.error('Error getting conversation with user:', error);
    return null;
  }
}
