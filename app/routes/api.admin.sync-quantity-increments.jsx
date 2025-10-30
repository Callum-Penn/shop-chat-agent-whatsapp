/**
 * Admin API Route: Sync Product Quantity Increments
 * Fetches all products with quantity_increment metafields and updates the config
 */
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import fs from 'fs/promises';
import path from 'path';

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Fetch all products with quantity_increment metafield
    const response = await admin.graphql(`
      #graphql
      query getProductsWithQuantityIncrement {
        products(first: 250) {
          edges {
            node {
              id
              title
              metafields(first: 10, namespace: "custom", key: "quantity_increment") {
                edges {
                  node {
                    id
                    key
                    value
                    type
                  }
                }
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    metafields(first: 10, namespace: "custom", key: "quantity_increment") {
                      edges {
                        node {
                          id
                          key
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
        }
      }
    `);

    const data = await response.json();
    const products = data.data.products.edges;

    // Build quantity increments map
    const quantityIncrements = {};
    
    for (const { node: product } of products) {
      // Check product-level metafield
      const productMetafield = product.metafields.edges.find(
        e => e.node.key === 'quantity_increment'
      );
      
      if (productMetafield) {
        const increment = parseInt(productMetafield.node.value, 10);
        if (!isNaN(increment)) {
          quantityIncrements[product.id] = increment;
        }
      }
      
      // Check variant-level metafields
      for (const { node: variant } of product.variants.edges) {
        const variantMetafield = variant.metafields.edges.find(
          e => e.node.key === 'quantity_increment'
        );
        
        if (variantMetafield) {
          const increment = parseInt(variantMetafield.node.value, 10);
          if (!isNaN(increment)) {
            quantityIncrements[variant.id] = increment;
          }
        }
      }
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

