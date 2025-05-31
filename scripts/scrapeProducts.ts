const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

type Product = {
  name: string;
  url: string;
  image: string;
  category: string;
  originalPrice: string;
  currentPrice: string;
  rating: string;
  description: string;
  discount: string;
}

async function fetchProductDescription(url: string) {
  try {
    const response = await axios.get('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    
    // Try different selectors for product description
    const selectors = [
      '.woocommerce-Tabs-panel--description',
      '.woocommerce-product-details__short-description',
      '.product-description',
      '.description'
    ];
    
    let description = '';
    for (const selector of selectors) {
      const text = $(selector).text().trim();
      if (text) {
        description = text;
        break;
      }
    }
    
    // Clean up the description
    const cleanDescription = description
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\t+/g, ' ')
      .trim();
      
    return cleanDescription || 'No description available';
  } catch (error) {
    console.error(`Error fetching description from ${url}:`, error);
    return 'Failed to fetch description';
  }
}

async function scrapeProducts() {
  try {
    console.log('Starting to scrape products...');
    
    // 1. Fetch main shop page
    // Use a proxy service to handle website restrictions
    const response = await axios.get('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://pcgameskey.com/shop/'), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    
    // Debug: Log the HTML structure
    console.log('HTML Structure:', $.html());
    
    const products: Product[] = [];
    
    // Try different product selectors
    const selectors = [
      '.post-type-archive-product li',
      '.products li',
      '.product',
      '[class*="product"]',
      'article'
    ];
    
    let productElements = null;
    for (const selector of selectors) {
      const elements = $(selector);
      console.log(`Selector "${selector}" found ${elements.length} elements`);
      if (elements.length > 0) {
        productElements = elements;
        console.log(`Using selector "${selector}" with ${elements.length} products found`);
        break;
      }
    }
    
    if (!productElements || productElements.length === 0) {
      throw new Error('No product elements found with any selector');
    }

    // Process each product
    for (let i = 0; i < productElements.length; i++) {
      const el = productElements[i];
      try {
        const $el = $(el);
        
        // Clean up text content by removing excessive whitespace
        const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim();

        // Extract basic product information
        const name = cleanText($el.find('h3').text());
        const url = $el.find('h3 a').attr('href') || '';
        const image = $el.find('img').attr('src') || '';
        const category = 'SOFTWARE';
        
        // Extract price information
        const priceText = cleanText($el.text());
        const originalPriceMatch = priceText.match(/Original price was: Us\$ ([\d.]+)/);
        const currentPriceMatch = priceText.match(/Current price is: Us\$ ([\d.]+)/);
        const originalPrice = originalPriceMatch ? `Us$ ${originalPriceMatch[1]}` : 'N/A';
        const currentPrice = currentPriceMatch ? `Us$ ${currentPriceMatch[1]}` : 'N/A';
        
        // Extract rating
        const ratingText = $el.find('.star-rating').text();
        const rating = ratingText ? ratingText.match(/\d+/)?.[0] || '5' : '5';
        
        // Calculate discount
        let discount = 'N/A';
        if (originalPrice !== 'N/A' && currentPrice !== 'N/A') {
          const origPrice = parseFloat(originalPrice.replace('Us$ ', ''));
          const currPrice = parseFloat(currentPrice.replace('Us$ ', ''));
          const discountPercent = Math.round(((origPrice - currPrice) / origPrice) * 100);
          discount = `${discountPercent}%`;
        }

        // Fetch product description from individual product page
        console.log(`Fetching description for ${name}...`);
        const description = await fetchProductDescription(url);
        
        if (name && url) {
          products.push({
            name,
            url,
            image,
            category,
            originalPrice,
            currentPrice,
            rating,
            description,
            discount
          });
          console.log(`Successfully processed: ${name}`);
        }
      } catch (innerError) {
        console.error('Error processing a product:', innerError);
      }
    }

    if (!products.length) {
      throw new Error('No products were found on the page');
    }

    // 3. Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // 4. Setup CSV writer
    const csvWriter = createCsvWriter({
      path: path.join(outputDir, 'products.csv'),
      header: [
        { id: 'name', title: 'Product Name' },
        { id: 'url', title: 'URL' },
        { id: 'image', title: 'Image URL' },
        { id: 'category', title: 'Category' },
        { id: 'originalPrice', title: 'Original Price' },
        { id: 'currentPrice', title: 'Current Price' },
        { id: 'discount', title: 'Discount' },
        { id: 'rating', title: 'Rating' },
        { id: 'description', title: 'Description' }
      ]
    });

    // 5. Write data to CSV
    await csvWriter.writeRecords(products);
    console.log(`\nScraping complete! ${products.length} products saved to: ${path.join(outputDir, 'products.csv')}`);

  } catch (error) {
    console.error('Error during scraping:', error);
  }
}

// Run the scraper
scrapeProducts();
