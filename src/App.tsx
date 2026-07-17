import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CartProvider } from "./lib/cart";
import { CustomerProvider } from "./lib/customer";
import { StoreFooter, StoreHeader } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { ShopPage } from "./pages/Shop";
import { ProductPage } from "./pages/Product";
import { CartPage } from "./pages/Cart";
import { CheckoutPage } from "./pages/Checkout";
import { OrdersPage } from "./pages/Orders";
import { AccountPage } from "./pages/Account";
import {
  AdminDashboard,
  AdminLayout,
  AdminLogin,
} from "./pages/admin/AdminShell";
import { AdminProducts } from "./pages/admin/Products";
import { AdminOrders } from "./pages/admin/Orders";
import { AdminDiscounts } from "./pages/admin/Discounts";
import { AdminDelivery } from "./pages/admin/Delivery";
import { AdminRevenue } from "./pages/admin/Revenue";
import { AdminAuctions } from "./pages/admin/Auctions";
import { AdminSettings } from "./pages/admin/Settings";
import { AuctionsPage } from "./pages/Auctions";
import { AuctionDetailPage } from "./pages/AuctionDetail";

function StoreShell({ children }: { children: ReactNode }) {
  return (
    <>
      <StoreHeader />
      <main>{children}</main>
      <StoreFooter />
    </>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="auctions" element={<AdminAuctions />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="revenue" element={<AdminRevenue />} />
          <Route path="discounts" element={<AdminDiscounts />} />
          <Route path="delivery" element={<AdminDelivery />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  return (
    <StoreShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/auctions/:slug" element={<AuctionDetailPage />} />
        <Route path="/product/:slug" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StoreShell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <CustomerProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </CustomerProvider>
    </BrowserRouter>
  );
}

