import type { Product, ScrapingStats } from './types';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

// Constants
const BASE_URL = 'https://pcgameskey.com/shop';
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const LOG_DIR = path.join(OUTPUT_DIR, 'logs');
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
];

// Utility Functions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const setupDirectories = () => {
  [OUTPUT_DIR, LOG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

const logError = (error: Error, context: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${context}: ${error.message}\n${error.stack}\n\n`;
  fs.appendFileSync(path.join(LOG_DIR, 'error.log'), logMessage);
  console.error(`Error in ${context}:`, error.message);
};

// Request handling with retry mechanism
async function makeRequest(url: string, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Making request to ${url} (attempt ${attempt}/${retries})`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
        },
        timeout: 10000
      });
      console.log(`Response status: ${response.status}`);
      console.log(`Response content length: ${response.data.length}`);
      console.log('First 500 characters of response:', response.data.substring(0, 500));
      return response.data;
    } catch (error: any) {
      console.error(`Request failed (attempt ${attempt}/${retries}):`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: url
      });
      
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        throw error;
      }
      
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.log(`Retrying after ${delay}ms delay...`);
      await sleep(delay);
    }
  }
  throw new Error('All retry attempts failed');
}

// Product Scraping Functions
async function fetchProductDescription(url: string): Promise<string> {
  try {
    const html = await makeRequest(url);
    const $ = cheerio.load(html);
    
    const selectors = [
      '.woocommerce-Tabs-panel--description',
      '.woocommerce-product-details__short-description',
      '.product-description',
      '.description',
      '[itemprop="description"]'
    ];
    
    let description = '';
    for (const selector of selectors) {
      const text = $(selector).text().trim();
      if (text) {
        description = text;
        break;
      }
    }
    
    return description
      .replace(/\\s+/g, ' ')
      .replace(/\\n+/g, ' ')
      .replace(/\\t+/g, ' ')
      .trim() || 'No description available';
  } catch (error) {
    logError(error as Error, `Fetching description from ${url}`);
    return 'Failed to fetch description';
  }
}

async function extractProductData($: any, element: any): Promise<Product | null> {
  try {
    const $el = $(element);
    
    // Product name and URL
    const nameElement = $el.find('.product-title, h2.woocommerce-loop-product__title, h3');
    const name = nameElement.text().trim();
    const url = nameElement.find('a').attr('href') || '';
    
    console.log('\nExtracting product:', { name, url });
    
    if (!name || !url) {
      console.log('Missing name or URL, skipping product');
      return null;
    }

    // Get product page HTML to find the actual image
    console.log('Fetching product page for image...');
    const productHtml = await makeRequest(url);
    const $product = cheerio.load(productHtml);
    
    // Try to get image from meta tags first
    let image = $product('meta[property="og:image"]').attr('content') ||
                $product('meta[name="twitter:image"]').attr('content');
    
    // If no meta image, try multiple selectors
    if (!image || image.includes('wooproductph.png') || image.includes('blank.gif')) {
      const imageSelectors = [
        '.woocommerce-product-gallery__image img',
        '.product-image img',
        '.product-gallery img',
        'img.wp-post-image',
        'img[src*="product"]',
        'img[src*="windows"]',
        'img[src*="office"]',
        '.rh-flex-center-align img'
      ];
      
      for (const selector of imageSelectors) {
        const img = $product(selector).first();
        const src = img.attr('src') || img.attr('data-src') || '';
        if (src && !src.includes('wooproductph.png') && !src.includes('blank.gif')) {
          image = src;
          console.log(`Found image using selector: ${selector}`);
          break;
        }
      }
    } else {
      console.log('Found image in meta tags');
    }
    console.log('Image URL:', image || 'No image found');
    
    // Price information
    const priceElement = $el.find('.price');
    const originalPrice = priceElement.find('del').text().trim() || 'N/A';
    const currentPrice = priceElement.find('ins').text().trim() || priceElement.text().trim();
    console.log('Price info:', { originalPrice, currentPrice });
    
    // Rating
    const ratingText = $el.find('.star-rating').text();
    const rating = ratingText ? ratingText.match(/\\d+/)?.[0] || '5' : '5';
    console.log('Rating:', rating);
    
    // Calculate discount
    let discount = 'N/A';
    if (originalPrice !== 'N/A' && currentPrice) {
      const origPrice = parseFloat(originalPrice.replace(/[^0-9.]/g, ''));
      const currPrice = parseFloat(currentPrice.replace(/[^0-9.]/g, ''));
      if (!isNaN(origPrice) && !isNaN(currPrice)) {
        const discountPercent = Math.round(((origPrice - currPrice) / origPrice) * 100);
        discount = `${discountPercent}%`;
      }
    }

    // Fetch description
    console.log(`Fetching description for ${name}...`);
    const description = await fetchProductDescription(url);
    
    return {
      name,
      url,
      image,
      category: 'SOFTWARE',
      originalPrice,
      currentPrice,
      rating,
      description,
      discount
    };
  } catch (error) {
    logError(error as Error, `Extracting product data`);
    return null;
  }
}

async function getNextPageUrl($: any): Promise<string | null> {
  const nextPageSelectors = [
    '.woocommerce-pagination .next',
    '.pagination .next',
    'a.next.page-numbers'
  ];
  
  for (const selector of nextPageSelectors) {
    const nextPageElement = $(selector);
    if (nextPageElement.length) {
      return nextPageElement.attr('href') || null;
    }
  }
  
  return null;
}

async function scrapePage(url: string, stats: ScrapingStats): Promise<Product[]> {
  try {
    console.log(`Scraping page ${stats.currentPage}...`);
    const html = await makeRequest(url);
    const $ = cheerio.load(html);
    
    // Debug: Log some basic page info
    console.log('Page title:', $('title').text());
    console.log('Meta description:', $('meta[name="description"]').attr('content'));
    
    const productSelectors = [
      '.products li.product',
      '.woocommerce-products-grid .product',
      '.product-grid-item',
      '[class*="product-item"]',
      // Add more generic selectors
      '.product',
      '[class*="product"]',
      'article'
    ];
    
    let productElements: any[] = [];
    for (const selector of productSelectors) {
      console.log(`Trying selector: ${selector}`);
      const elements = $(selector).toArray();
      console.log(`Found ${elements.length} elements with selector: ${selector}`);
      
      if (elements.length > 0) {
        // Debug: Log the first element's HTML
        console.log('First element HTML:', $(elements[0]).html()?.substring(0, 200));
        productElements = elements;
        console.log(`Using selector: ${selector} with ${elements.length} products`);
        break;
      }
    }
    
    const products: Product[] = [];
    for (const element of productElements) {
      const product = await extractProductData($, element);
      if (product) {
        products.push(product);
        stats.totalProducts++;
      } else {
        stats.failedProducts++;
      }
      await sleep(1000); // Delay between product processing
    }
    
    return products;
  } catch (error) {
    logError(error as Error, `Scraping page ${url}`);
    return [];
  }
}

// Main scraping function
async function scrapeProducts() {
  try {
    console.log('Starting product scraping...');
    setupDirectories();
    
    const stats: ScrapingStats = {
      totalProducts: 0,
      failedProducts: 0,
      currentPage: 1,
      totalPages: 1,
      startTime: new Date()
    };
    
    const allProducts: Product[] = [];
    let currentUrl = BASE_URL;
    
    // CSV Writer setup
    const csvWriter = createObjectCsvWriter({
      path: path.join(OUTPUT_DIR, 'products.csv'),
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
    
    // Scrape all pages
    while (currentUrl) {
      const products = await scrapePage(currentUrl, stats);
      allProducts.push(...products);
      
      // Save progress after each page
      await csvWriter.writeRecords(allProducts);
      
      // Get next page URL
      const html = await makeRequest(currentUrl);
      const $ = cheerio.load(html);
      currentUrl = await getNextPageUrl($) || '';
      
      if (currentUrl) {
        stats.currentPage++;
        await sleep(2000); // Delay between pages
      }
    }
    
    // Generate summary
    const duration = (new Date().getTime() - stats.startTime.getTime()) / 1000;
    const summary = {
      totalProducts: stats.totalProducts,
      failedProducts: stats.failedProducts,
      totalPages: stats.currentPage,
      duration: `${duration.toFixed(2)} seconds`,
      successRate: `${((stats.totalProducts / (stats.totalProducts + stats.failedProducts)) * 100).toFixed(2)}%`
    };
    
    // Save summary
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log('\nScraping completed!');
    console.log('Summary:', summary);
    
  } catch (error) {
    logError(error as Error, 'Main scraping process');
    process.exit(1);
  }
}

// Run the scraper
scrapeProducts();
