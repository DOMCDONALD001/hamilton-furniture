import type { ReactNode } from "react";
import { useEffect } from "react";
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
import { AdminInventoryReport } from "./pages/admin/InventoryReport";
import { AdminAuctions } from "./pages/admin/Auctions";
import { AdminSettings } from "./pages/admin/Settings";
import { AdminDrivers } from "./pages/admin/Drivers";
import { AdminLiveDrivers } from "./pages/admin/LiveDrivers";
import { AdminRoutes } from "./pages/admin/Routes";
import { AdminReports } from "./pages/admin/Reports";
import { AdminPos } from "./pages/admin/Pos";
import { AdminClaims } from "./pages/admin/Claims";
import { AdminPhotoDrop } from "./pages/admin/PhotoDrop";
import { AuctionsPage } from "./pages/Auctions";
import { AuctionDetailPage } from "./pages/AuctionDetail";
import { AuctionPayPage } from "./pages/AuctionPay";
import { ClaimsPage } from "./pages/Claims";
import {
  DriverHome,
  DriverIssues,
  DriverLayout,
  DriverLogin,
  DriverRouteDetail,
} from "./pages/driver/DriverShell";

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname, search]);

  return null;
}

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
  const isDriver = location.pathname.startsWith("/driver");

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="photos" element={<AdminPhotoDrop />} />
          <Route path="auctions" element={<AdminAuctions />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="pos" element={<AdminPos />} />
          <Route path="claims" element={<AdminClaims />} />
          <Route path="revenue" element={<AdminRevenue />} />
          <Route path="inventory-report" element={<AdminInventoryReport />} />
          <Route path="discounts" element={<AdminDiscounts />} />
          <Route path="delivery" element={<AdminDelivery />} />
          <Route path="routes" element={<AdminRoutes />} />
          <Route path="live" element={<AdminLiveDrivers />} />
          <Route path="drivers" element={<AdminDrivers />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  if (isDriver) {
    return (
      <Routes>
        <Route path="/driver/login" element={<DriverLogin />} />
        <Route path="/driver" element={<DriverLayout />}>
          <Route index element={<DriverHome />} />
          <Route path="routes/:id" element={<DriverRouteDetail />} />
          <Route path="issues" element={<DriverIssues />} />
        </Route>
        <Route path="*" element={<Navigate to="/driver" replace />} />
      </Routes>
    );
  }

  return (
    <StoreShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/auctions/pay/:token" element={<AuctionPayPage />} />
        <Route path="/auctions/:slug" element={<AuctionDetailPage />} />
        <Route path="/product/:slug" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/claims" element={<ClaimsPage />} />
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
          <ScrollToTop />
          <AppRoutes />
        </CartProvider>
      </CustomerProvider>
    </BrowserRouter>
  );
}
