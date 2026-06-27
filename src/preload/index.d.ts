import type { Go2JoyApi } from './index'

declare global {
  interface Window {
    go2joy: Go2JoyApi
  }
}

export {}
