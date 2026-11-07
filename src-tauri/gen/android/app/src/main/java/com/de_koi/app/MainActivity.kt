package com.de_koi.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // De-Koi's shell is dark, so the system bars get light icons.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    // Keep the page out from under the status bar, the gesture/navigation bar, a notch and the keyboard.
    // Many Android System WebView versions report env(safe-area-inset-*) as 0 in an edge-to-edge app, which
    // put setup's Done button under the gesture bar. Insets are consumed here, so a WebView that does report
    // them sees none and the page never pads twice.
    val content = findViewById<View>(android.R.id.content)
    content.setBackgroundColor(SYSTEM_BAR_BACKGROUND)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  private companion object {
    // The dark shell's header colour, shown behind the system bars.
    val SYSTEM_BAR_BACKGROUND = Color.parseColor("#020E16")
  }
}
