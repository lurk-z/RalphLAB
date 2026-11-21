"use client";

import { Component, type ReactNode } from "react";

export default class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <div role="alert" className="grid h-full place-content-center gap-3 text-center text-sm text-slate-700">
        <p>เปิดห้อง 3D ไม่สำเร็จ กรุณาตรวจว่าเบราว์เซอร์รองรับ WebGL</p>
        <button type="button" className="mx-auto rounded-md border bg-white px-4 py-2" onClick={() => window.location.reload()}>ลองอีกครั้ง</button>
      </div>;
    }
    return this.props.children;
  }
}
