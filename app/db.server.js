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

// ===================================
// USER MANAGEMENT FUNCTIONS
// ===================================

/**
 * Create or get a user by their identifier
 * @param {Object} userInfo - User information
 * @param {string} userInfo.type - User type ("web" or "whatsapp")
 * @param {string} [userInfo.shopifyCustomerId] - Shopify customer ID
 * @param {string} [userInfo.phoneNumber] - Phone number (for WhatsApp)
 * @param {string} [userInfo.email] - Email address
 * @param {string} [userInfo.name] - User name
 * @param {Object} [userInfo.metadata] - Additional metadata
 * @returns {Promise<Object>} - The user object
 */
export async function createOrGetUser(userInfo) {
  try {
    const { type, shopifyCustomerId, phoneNumber, email, name, metadata } = userInfo;

    // Try to find existing user by unique identifiers
    let user = null;
    
    if (phoneNumber) {
      user = await prisma.user.findUnique({
        where: { phoneNumber }
      });
    } else if (shopifyCustomerId) {
      user = await prisma.user.findFirst({
        where: { shopifyCustomerId }
      });
    } else if (email) {
      user = await prisma.user.findFirst({
        where: { email }
      });
    }

    // If user exists, update their information
    if (user) {
      return await prisma.user.update({
        where: { id: user.id },
        data: {
          name: name || user.name,
          email: email || user.email,
          shopifyCustomerId: shopifyCustomerId || user.shopifyCustomerId,
          metadata: metadata || user.metadata,
          updatedAt: new Date()
        }
      });
    }

    // Create new user
    return await prisma.user.create({
      data: {
        type,
        shopifyCustomerId,
        phoneNumber,
        email,
        name,
        metadata
      }
    });
  } catch (error) {
    console.error('Error creating or getting user:', error);
    throw error;
  }
}

/**
 * Get user by ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object|null>} - The user object or null
 */
export async function getUserById(userId) {
  try {
    return await prisma.user.findUnique({
      where: { id: userId }
    });
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}

/**
 * Get all WhatsApp users for broadcasting
 * @returns {Promise<Array>} - Array of WhatsApp users with phone numbers
 */
export async function getAllWhatsAppUsers() {
  try {
    return await prisma.user.findMany({
      where: {
        type: 'whatsapp',
        phoneNumber: {
          not: null
        }
      },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        createdAt: true,
        metadata: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  } catch (error) {
    console.error('Error getting WhatsApp users:', error);
    return [];
  }
}

/**
 * Get user by phone number
 * @param {string} phoneNumber - The phone number
 * @returns {Promise<Object|null>} - The user object or null
 */
export async function getUserByPhoneNumber(phoneNumber) {
  try {
    return await prisma.user.findUnique({
      where: { phoneNumber }
    });
  } catch (error) {
    console.error('Error retrieving user by phone number:', error);
    return null;
  }
}

/**
 * Get user by Shopify customer ID
 * @param {string} shopifyCustomerId - The Shopify customer ID
 * @returns {Promise<Object|null>} - The user object or null
 */
export async function getUserByShopifyCustomerId(shopifyCustomerId) {
  try {
    return await prisma.user.findFirst({
      where: { shopifyCustomerId }
    });
  } catch (error) {
    console.error('Error retrieving user by Shopify customer ID:', error);
    return null;
  }
}

/**
 * Update user information
 * @param {string} userId - The user ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} - The updated user object
 */
export async function updateUser(userId, updateData) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        ...updateData,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

/**
 * Link a conversation to a user
 * @param {string} conversationId - The conversation ID
 * @param {string} userId - The user ID
 * @param {string} channel - The channel ("web" or "whatsapp")
 * @returns {Promise<Object>} - The updated conversation
 */
export async function linkConversationToUser(conversationId, userId, channel = 'web') {
  try {
    // First, ensure the conversation exists
    await createOrUpdateConversation(conversationId);
    
    // Then link it to the user
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

// ===================================
// CONVERSATION ARCHIVING FUNCTIONS
// ===================================

/**
 * Archive old conversations that haven't been updated recently
 * @param {number} daysInactive - Number of days of inactivity before archiving (default: 30)
 * @returns {Promise<number>} - Number of conversations archived
 */
export async function archiveOldConversations(daysInactive = 30) {
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

    console.log(`Archived ${result.count} old conversations (inactive for ${daysInactive}+ days)`);
    return result.count;
  } catch (error) {
    console.error('Error archiving old conversations:', error);
    return 0;
  }
}

/**
 * Delete archived conversations and their messages older than specified days
 * @param {number} daysOld - Number of days old the archived conversation must be (default: 90)
 * @returns {Promise<number>} - Number of conversations deleted
 */
export async function deleteOldArchivedConversations(daysOld = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

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

    // Delete messages first (due to foreign key constraint)
    await prisma.message.deleteMany({
      where: {
        conversationId: { in: conversationIds }
      }
    });

    // Delete customer account URLs
    await prisma.customerAccountUrl.deleteMany({
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

    console.log(`Deleted ${result.count} archived conversations (older than ${daysOld} days)`);
    return result.count;
  } catch (error) {
    console.error('Error deleting old archived conversations:', error);
    return 0;
  }
}

/**
 * Get conversation statistics for monitoring
 * @returns {Promise<Object>} - Statistics object
 */
export async function getConversationStats() {
  try {
    const [totalConversations, archivedConversations, totalUsers, totalMessages] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { archived: true } }),
      prisma.user.count(),
      prisma.message.count()
    ]);

    return {
      totalConversations,
      activeConversations: totalConversations - archivedConversations,
      archivedConversations,
      totalUsers,
      totalMessages
    };
  } catch (error) {
    console.error('Error getting conversation stats:', error);
    return null;
  }
}
