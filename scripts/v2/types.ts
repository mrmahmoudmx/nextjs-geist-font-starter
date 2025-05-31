export interface Product {
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

export interface ScrapingStats {
  totalProducts: number;
  failedProducts: number;
  currentPage: number;
  totalPages: number;
  startTime: Date;
}
