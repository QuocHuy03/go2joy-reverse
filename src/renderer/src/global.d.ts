import type { Go2JoyApi } from '../../preload/index'

declare global {
  interface Window {
    go2joy: Go2JoyApi
  }
}

export {}
