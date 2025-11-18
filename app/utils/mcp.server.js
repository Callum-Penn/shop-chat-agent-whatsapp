import { storeCustomerAccountUrl, getCustomerAccountUrl } from "../db.server";
import { unauthenticated } from "../shopify.server";

/**
 * Normalize a store domain or URL into a protocol + host string.
 * @param {string} domainOrUrl
 * @returns {string|null}
 */
export function normalizeStorefrontDomain(domainOrUrl) {
  if (!domainOrUrl || typeof domainOrUrl !== "string") {
    return null;
  }

  const trimmed = domainOrUrl.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = trimmed.startsWith("http")
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the preferred storefront domain from env or provided value.
 * @param {string} preferredDomain
 * @returns {string|null}
 */
export function getPreferredStoreDomain(preferredDomain) {
  return (
    normalizeStorefrontDomain(process.env.STOREFRONT_DOMAIN) ||
    normalizeStorefrontDomain(process.env.SHOP_CUSTOM_DOMAIN) ||
    normalizeStorefrontDomain(preferredDomain) ||
    null
  );
}

/**
 * Build the storefront MCP endpoint.
 * @param {string} preferredDomain
 * @returns {string|null}
 */
export function getStorefrontMcpEndpoint(preferredDomain) {
  const explicit = process.env.MCP_STOREFRONT_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const baseDomain =
    normalizeStorefrontDomain(preferredDomain) || getPreferredStoreDomain();

  return baseDomain ? `${baseDomain}/api/mcp` : null;
}

/**
 * Determine a shop identifier (defaults to hostname).
 * @param {string} explicitShopId
 * @param {string} domainOrUrl
 * @returns {string|null}
 */
export function getConfiguredShopId(explicitShopId, domainOrUrl) {
  if (explicitShopId) {
    return explicitShopId;
  }
  const normalized =
    normalizeStorefrontDomain(domainOrUrl) || getPreferredStoreDomain();
  if (!normalized) {
    return null;
  }
  return new URL(normalized).hostname;
}

/**
 * Resolve the customer MCP endpoint (customer accounts server).
 * @param {string} shopDomain
 * @param {string} conversationId
 * @returns {Promise<string|null>}
 */
export async function resolveCustomerMcpEndpoint(shopDomain, conversationId) {
  const explicit = process.env.MCP_CUSTOMER_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const normalizedShopDomain =
    normalizeStorefrontDomain(shopDomain) || getPreferredStoreDomain();

  if (!normalizedShopDomain) {
    console.error(
      "Unable to resolve customer MCP endpoint: missing storefront domain"
    );
    return null;
  }

  // Check cached DB value first
  if (conversationId) {
    const cached = await getCustomerAccountUrl(conversationId);
    if (cached) {
      const normalizedAccount = normalizeStorefrontDomain(cached);
      if (normalizedAccount) {
        return `${normalizedAccount}/customer/api/mcp`;
      }
    }
  }

  try {
    const hostname = new URL(normalizedShopDomain).hostname;
    const { storefront } = await unauthenticated.storefront(hostname);
    const response = await storefront.graphql(`#graphql
      query shopCustomerAccountUrl {
        shop {
          customerAccountUrl
        }
      }`);
    const body = await response.json();
    const customerAccountUrl = body?.data?.shop?.customerAccountUrl;
    const normalizedAccount = normalizeStorefrontDomain(customerAccountUrl);

    if (normalizedAccount) {
      if (conversationId) {
        await storeCustomerAccountUrl(conversationId, normalizedAccount);
      }
      return `${normalizedAccount}/customer/api/mcp`;
    }
  } catch (error) {
    console.error("Error resolving customer MCP endpoint:", error);
  }

  return null;
}

