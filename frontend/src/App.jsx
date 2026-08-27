import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { StoreProvider } from './context/StoreProvider'
import { CustomerLayout, ConsoleLayout } from './components/layout/Layouts'

import Landing from './pages/Landing'
import Join from './pages/Join'
import QueueStatus from './pages/QueueStatus'

import CustomerHome from './pages/customer/Home'
import CustomerMenu from './pages/customer/Menu'
import CustomerStatus from './pages/customer/Status'
import CustomerBill from './pages/customer/Bill'

import StaffFloor from './pages/staff/Floor'
import StaffQueue from './pages/staff/Queue'
import StaffKitchen from './pages/staff/Kitchen'
import StaffServe from './pages/staff/Serve'
import StaffCheckout from './pages/staff/Checkout'

import AdminDashboard from './pages/admin/Dashboard'
import AdminMenu from './pages/admin/Menu'
import { AdminPackages, AdminTables, AdminSettings } from './pages/admin/Manage'

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />

          {/* QR บนสลิป — ผูก session เข้ากับ visit แล้วเด้งไป /order */}
          <Route path="/v/:token" element={<Join />} />

          {/* QR บนบัตรคิว — เปิดได้โดยไม่ต้องล็อกอิน */}
          <Route path="/q/:token" element={<QueueStatus />} />

          {/* ฝั่งลูกค้า — ของจริงเข้าผ่าน /v/:token จาก QR บนสลิป */}
          <Route path="/order" element={<CustomerLayout />}>
            <Route index element={<CustomerHome />} />
            <Route path="menu" element={<CustomerMenu />} />
            <Route path="status" element={<CustomerStatus />} />
            <Route path="bill" element={<CustomerBill />} />
          </Route>

          {/* ฝั่งพนักงาน & ครัว */}
          <Route path="/staff" element={<ConsoleLayout kind="staff" />}>
            <Route index element={<StaffFloor />} />
            <Route path="queue" element={<StaffQueue />} />
            <Route path="kds" element={<StaffKitchen />} />
            <Route path="serve" element={<StaffServe />} />
            <Route path="checkout" element={<StaffCheckout />} />
          </Route>

          {/* ฝั่งผู้จัดการ */}
          <Route path="/admin" element={<ConsoleLayout kind="admin" />}>
            <Route index element={<AdminDashboard />} />
            <Route path="menu" element={<AdminMenu />} />
            <Route path="packages" element={<AdminPackages />} />
            <Route path="tables" element={<AdminTables />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  )
}
