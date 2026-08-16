import subprocess
import time
import os
import signal
from playwright.sync_api import sync_playwright

def run_scenario():
    # 1. Start the backend
    backend_proc = subprocess.Popen(["python", "-m", "uvicorn", "main:app", "--port", "8000"], cwd="e:/chatt/Group-Chat-Application/backend")
    
    # 2. Start the frontend
    frontend_proc = subprocess.Popen(["npm.cmd", "run", "dev"], cwd="e:/chatt/Group-Chat-Application/frontend")
    
    # Wait for servers to spin up
    print("Waiting for servers to start...")
    time.sleep(10)
    
    try:
        with sync_playwright() as p:
            print("Launching browsers...")
            # We use two separate browser instances to simulate two different users/sessions
            browser_aditya = p.chromium.launch(headless=True)
            context_aditya = browser_aditya.new_context(viewport={"width": 1000, "height": 800})
            page_aditya = context_aditya.new_page()
            
            browser_hirannya = p.chromium.launch(headless=True)
            context_hirannya = browser_hirannya.new_context(viewport={"width": 1000, "height": 800})
            page_hirannya = context_hirannya.new_page()
            
            # --- SCENARIO START ---
            
            # 1. Aditya Login Page
            page_aditya.goto("http://localhost:5173")
            page_aditya.wait_for_selector("#username-input")
            page_aditya.fill("#username-input", "Aditya")
            time.sleep(1)
            page_aditya.screenshot(path="e:/chatt/Group-Chat-Application/1_login_page.png")
            print("Screenshot 1 taken.")
            page_aditya.click("#join-btn")
            time.sleep(2)
            
            # 2. Chat room light and dark mode
            # Default is dark mode. 
            page_aditya.screenshot(path="e:/chatt/Group-Chat-Application/2_chat_room_dark.png")
            print("Screenshot 2 (dark) taken.")
            # Switch to light mode
            page_aditya.click("#theme-toggle-chat")
            time.sleep(1)
            page_aditya.screenshot(path="e:/chatt/Group-Chat-Application/2_chat_room_light.png")
            print("Screenshot 2 (light) taken.")
            # Switch back to dark mode
            page_aditya.click("#theme-toggle-chat")
            time.sleep(1)
            
            # Hirannya joins
            page_hirannya.goto("http://localhost:5173")
            page_hirannya.fill("#username-input", "Hirannya")
            page_hirannya.click("#join-btn")
            time.sleep(2)
            
            # 3. Message from Aditya, readable by Hirannya
            page_aditya.fill("#message-input", "Hey Hirannya, are you there?")
            page_aditya.click("#send-btn")
            time.sleep(2)
            
            page_hirannya.screenshot(path="e:/chatt/Group-Chat-Application/3_message_from_aditya.png")
            print("Screenshot 3 taken.")
            
            # Hirannya responds so Aditya can reply to it
            page_hirannya.fill("#message-input", "Yes, I am here Aditya!")
            page_hirannya.click("#send-btn")
            time.sleep(2)
            
            # 4. Aditya replies to Hirannya's message
            # Click the reply button on Hirannya's message
            # Find the last message's reply button
            page_aditya.locator(".msg-action-btn--reply").last.click()
            time.sleep(1)
            page_aditya.fill("#message-input", "Awesome! The reply feature works.")
            page_aditya.click("#send-btn")
            time.sleep(2)
            
            page_aditya.screenshot(path="e:/chatt/Group-Chat-Application/4_aditya_replies.png")
            print("Screenshot 4 taken.")
            
            # 5. Hirannya closes tab (disconnects)
            page_hirannya.close()
            time.sleep(2) # wait for the server to process disconnect and broadcast system message
            
            page_aditya.screenshot(path="e:/chatt/Group-Chat-Application/5_disconnected.png")
            print("Screenshot 5 taken.")
            
            # Cleanup
            browser_aditya.close()
            browser_hirannya.close()
            
    finally:
        print("Shutting down servers...")
        backend_proc.terminate()
        frontend_proc.terminate()
        try:
            backend_proc.wait(timeout=5)
            frontend_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend_proc.kill()
            frontend_proc.kill()

if __name__ == "__main__":
    run_scenario()
