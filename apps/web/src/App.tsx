import { CollectPage } from '@/collect/CollectPage'
import { ProductApp } from '@/product/ProductApp'

/** Two entry points: the product at `/`, and volunteer data collection at `/collect`. */
export default function App() {
  return window.location.pathname.startsWith('/collect') ? <CollectPage /> : <ProductApp />
}
