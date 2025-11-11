/**
 * Admin API Route: Sync Product Quantity Increments
 * Fetches all products with quantity_increment metafields and updates the database
 */
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Build quantity increments data for database
    const incrementsToSave = [];

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
            incrementsToSave.push({
              entityId: product.id,
              increment,
              entityType: 'product',
              productTitle: product.title
            });
          }
        }

        // Variant-level metafield
        if (product.variants && product.variants.edges) {
          for (const { node: variant } of product.variants.edges) {
            if (variant.metafield && variant.metafield.value != null) {
              const increment = parseInt(variant.metafield.value, 10);
              if (!isNaN(increment)) {
                incrementsToSave.push({
                  entityId: variant.id,
                  increment,
                  entityType: 'variant',
                  productTitle: product.title
                });
              }
            }
          }
        }
      }

      hasNextPage = Boolean(productConnection?.pageInfo?.hasNextPage);
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    }

    // Clear existing increments and save new ones to database
    await prisma.productQuantityIncrement.deleteMany({});
    
    if (incrementsToSave.length > 0) {
      await prisma.productQuantityIncrement.createMany({
        data: incrementsToSave
      });
    }

    return json({ success: true, synced: incrementsToSave.length });
  } catch (error) {
    console.error('Error syncing quantity increments:', error);
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

