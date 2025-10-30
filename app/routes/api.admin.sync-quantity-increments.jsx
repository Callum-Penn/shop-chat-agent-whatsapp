/**
 * Admin API Route: Sync Product Quantity Increments
 * Fetches all products with quantity_increment metafields and updates the config
 */
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import fs from 'fs/promises';
import path from 'path';

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Build quantity increments map (across all pages)
    const quantityIncrements = {};

    // Paginate through all products (250 per page)
    let hasNextPage = true;
    let cursor = null;

    const query = `#graphql
      query getProductsWithQuantityIncrement($cursor: String) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage }
          edges {
            cursor
            node {
              id
              title
              metafield(namespace: "custom", key: "quantity_increment") {
                value
                type
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    metafield(namespace: "custom", key: "quantity_increment") {
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    while (hasNextPage) {
      const response = await admin.graphql(query, { variables: { cursor } });
      const data = await response.json();
      const productConnection = data?.data?.products;
      const edges = productConnection?.edges || [];

      for (const edge of edges) {
        const product = edge.node;

        // Product-level metafield
        if (product.metafield && product.metafield.value != null) {
          const increment = parseInt(product.metafield.value, 10);
          if (!isNaN(increment)) {
            quantityIncrements[product.id] = increment;
          }
        }

        // Variant-level metafield
        if (product.variants && product.variants.edges) {
          for (const { node: variant } of product.variants.edges) {
            if (variant.metafield && variant.metafield.value != null) {
              const increment = parseInt(variant.metafield.value, 10);
              if (!isNaN(increment)) {
                quantityIncrements[variant.id] = increment;
              }
            }
          }
        }
      }

      hasNextPage = Boolean(productConnection?.pageInfo?.hasNextPage);
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    }

    // Read existing config file
    const configPath = path.join(process.cwd(), 'app', 'config', 'quantity-increments.json');
    
    let configData;
    try {
      const existingContent = await fs.readFile(configPath, 'utf-8');
      const existingData = JSON.parse(existingContent);
      
      // Merge with existing data, prioritizing new data
      const mergedData = { ...existingData.default, ...quantityIncrements };
      configData = { default: mergedData };
    } catch (error) {
      // If file doesn't exist or is invalid, create new structure
      configData = { default: quantityIncrements };
    }

    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf-8');

    console.log(`Synced ${Object.keys(configData.default || {}).length} product quantity increments`);

    return json({
      success: true,
      count: Object.keys(configData.default || {}).length,
      message: 'Quantity increments synced successfully'
    });
  } catch (error) {
    console.error('Error syncing quantity increments:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

