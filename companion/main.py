import collections
import collections.abc
collections.Iterable = collections.abc.Iterable
collections.Mapping = collections.abc.Mapping
collections.MutableMapping = collections.abc.MutableMapping
collections.Sequence = collections.abc.Sequence
collections.MutableSequence = collections.abc.MutableSequence
collections.Container = collections.abc.Container
collections.Callable = collections.abc.Callable

import sys
import os
import time
import cv2
import numpy as np
import onnxruntime as rt
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

# ── Append DeepFaceLive to python search path ───────────────────────────────
DFL_PATH = r"C:\Users\DELL\.gemini\antigravity-ide\scratch\DeepFaceLive-master"
if DFL_PATH not in sys.path:
    sys.path.append(DFL_PATH)

from xlib.onnxruntime import get_available_devices_info, ORTDeviceInfo
from modelhub.onnx import YoloV5Face, InsightFace2D106, InsightFaceSwap
from xlib.face import ELandmarks2D, FLandmarks2D, FRect
from xlib.image import ImageProcessor

# ── Initialize FastAPI ──────────────────────────────────────────────────────
app = FastAPI(title="DiipMynd Local GPU Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Device & Model Loading ──────────────────────────────────────────────────
target_face_vector = None
face_detector = None
face_marker = None
swap_model = None
recommended_resolution = 512
current_device_name = "Unknown"

def load_models():
    global face_detector, face_marker, swap_model, recommended_resolution, current_device_name
    print("[DiipMynd] Querying available hardware platforms...")
    devices = get_available_devices_info()
    print("[DiipMynd] Found devices:", [str(d) for d in devices])
    
    # Selection priority: CUDA > DirectML > CPU
    best_device = devices[-1] # fallback to CPU
    for dev in devices:
        ep = dev.get_execution_provider()
        if ep == 'CUDAExecutionProvider':
            best_device = dev
            break
        elif ep == 'DmlExecutionProvider':
            best_device = dev
            
    print(f"[DiipMynd] Loading models on device: {best_device}")
    current_device_name = str(best_device)
    recommended_resolution = 512
    
    face_detector = YoloV5Face(best_device)
    face_marker = InsightFace2D106(best_device)
    swap_model = InsightFaceSwap(best_device)
    
    # Run a quick benchmark/warmup inference
    if best_device.get_execution_provider() == 'DmlExecutionProvider':
        print("[DiipMynd] Benchmarking DirectML device performance...")
        dummy_img = np.zeros((512, 512, 3), dtype=np.uint8)
        # Warmup pass (compiles DirectML shaders/pipelines)
        _ = face_detector.extract(dummy_img, threshold=0.25, fixed_window=256)[0]
        
        # Benchmark pass (measures actual execution latency)
        t0 = time.perf_counter()
        _ = face_detector.extract(dummy_img, threshold=0.25, fixed_window=256)[0]
        t_duration = time.perf_counter() - t0
        print(f"[DiipMynd] DirectML detection latency: {t_duration*1000:.1f}ms")
        
        # If latency is high (e.g. > 500ms), it's likely an integrated GPU with memory thrashing.
        # Fall back to CPU.
        if t_duration > 0.5:
            print("[DiipMynd] DirectML latency is too high (>500ms). Falling back to CPU for better performance...")
            # Find the CPU device
            cpu_device = None
            for dev in devices:
                if str(dev) == 'CPU' or dev.get_execution_provider() == 'CPUExecutionProvider':
                    cpu_device = dev
                    break
            if cpu_device is None:
                cpu_device = devices[-1]
                
            print(f"[DiipMynd] Reloading models on CPU device: {cpu_device}")
            current_device_name = str(cpu_device)
            recommended_resolution = 320
            
            face_detector = YoloV5Face(cpu_device)
            face_marker = InsightFace2D106(cpu_device)
            swap_model = InsightFaceSwap(cpu_device)
    elif best_device.get_execution_provider() == 'CPUExecutionProvider':
        current_device_name = "CPU"
        recommended_resolution = 320
            
    print("[DiipMynd] All models loaded successfully!")

@app.on_event("startup")
def startup_event():
    load_models()

# ── HTTP Endpoints ─────────────────────────────────────────────────────────

@app.get("/status")
def get_status():
    return {
        "status": "ready",
        "device": current_device_name,
        "recommended_resolution": recommended_resolution
    }

@app.post("/upload-face")
async def upload_face(file: UploadFile = File(...)):
    global target_face_vector
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        target_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if target_img is None:
            return {"error": "Invalid image file uploaded"}
            
        print("[DiipMynd] Extracting face vector from reference image...")
        
        # 1. Detection
        rects = face_detector.extract(target_img, threshold=0.3)[0]
        if len(rects) == 0:
            return {"error": "No face detected in reference image."}
            
        _, H, W, _ = ImageProcessor(target_img).get_dims()
        u_rects = [FRect.from_ltrb((l/W, t/H, r/W, b/H)) for l, t, r, b in rects]
        face_urect = FRect.sort_by_area_size(u_rects)[0]
        
        # 2. Landmarks
        face_image, face_uni_mat = face_urect.cut(target_img, 1.6, 192)
        lmrks = face_marker.extract(face_image)[0]
        lmrks = lmrks[..., 0:2] / (192, 192)
        face_ulmrks = FLandmarks2D.create(ELandmarks2D.L106, lmrks).transform(face_uni_mat, invert=True)
        
        # 3. Align face for embedding extraction with correct y_offset=-0.15
        face_align_img, _ = face_ulmrks.cut(target_img, 1.55, swap_model.get_face_vector_input_size(), y_offset=-0.15)
        
        # 4. Save face vector in memory
        target_face_vector = swap_model.get_face_vector(face_align_img)
        print("[DiipMynd] Reference face vector stored in memory.")
        return {"success": True}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

# ── WebSocket Stream Endpoints ──────────────────────────────────────────────

@app.websocket("/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    print("[DiipMynd] Web interface connected to streaming channel.")
    
    try:
        frame_count = 0
        while True:
            # Receive incoming webcam frame
            data = await websocket.receive_bytes()
            t_start = time.perf_counter()
            frame_count += 1
            
            nparr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                print(f"[DiipMynd] [{frame_count}] Failed to decode JPEG bytes.")
                continue
                
            # If no target face is loaded, echo back the original frame
            if target_face_vector is None:
                _, img_bytes = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                await websocket.send_bytes(img_bytes.tobytes())
                continue
                
            # 1. Detect face in incoming frame
            t_det_start = time.perf_counter()
            rects = face_detector.extract(img, threshold=0.25, fixed_window=256)[0]
            t_det = (time.perf_counter() - t_det_start) * 1000
            
            if len(rects) == 0:
                # No face in frame, echo back original
                _, img_bytes = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                await websocket.send_bytes(img_bytes.tobytes())
                print(f"[DiipMynd] [{frame_count}] Detection: {t_det:.1f}ms - 0 faces (echoed original)")
                continue
                
            H, W = img.shape[:2]
            u_rects = [FRect.from_ltrb((l/W, t/H, r/W, b/H)) for l, t, r, b in rects]
            face_urect = FRect.sort_by_area_size(u_rects)[0]
            
            # 2. Extract landmarks
            t_lm_start = time.perf_counter()
            face_image, face_uni_mat = face_urect.cut(img, 1.6, 192)
            lmrks = face_marker.extract(face_image)[0]
            lmrks = lmrks[..., 0:2] / (192, 192)
            face_ulmrks = FLandmarks2D.create(ELandmarks2D.L106, lmrks).transform(face_uni_mat, invert=True)
            t_lm = (time.perf_counter() - t_lm_start) * 1000
            
            # 3. Align face for swapper model (128x128 crop)
            t_align_start = time.perf_counter()
            mat, uni_mat = face_ulmrks.calc_cut((H, W), 2.2, 128, exclude_moving_parts=True, y_offset=-0.08)
            face_align_img = cv2.warpAffine(img, mat, (128, 128), cv2.INTER_CUBIC)
            t_align = (time.perf_counter() - t_align_start) * 1000
            
            # 4. Run face swap inference
            t_swap_start = time.perf_counter()
            swapped_align_img = swap_model.generate(face_align_img, target_face_vector)
            t_swap = (time.perf_counter() - t_swap_start) * 1000
            
            # 5. Compute face mask & blending & warp back
            t_blend_start = time.perf_counter()
            face_align_ulmrks = face_ulmrks.transform(uni_mat)
            mask = face_align_ulmrks.get_convexhull_mask((128, 128), color=(255,), dtype=np.uint8)
            mask_blurred = cv2.GaussianBlur(mask, (15, 15), 0)
            
            inv_mat = cv2.invertAffineTransform(mat)
            swapped_back = cv2.warpAffine(swapped_align_img, inv_mat, (W, H))
            mask_back = cv2.warpAffine(mask_blurred, inv_mat, (W, H))
            
            mask_back = np.expand_dims(mask_back.astype(np.float32) / 255.0, axis=-1)
            blended = (swapped_back.astype(np.float32) * mask_back + img.astype(np.float32) * (1.0 - mask_back)).astype(np.uint8)
            t_blend = (time.perf_counter() - t_blend_start) * 1000
            
            # Encode and send frame back to client
            t_enc_start = time.perf_counter()
            _, img_bytes = cv2.imencode('.jpg', blended, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            await websocket.send_bytes(img_bytes.tobytes())
            t_enc = (time.perf_counter() - t_enc_start) * 1000
            
            t_total = (time.perf_counter() - t_start) * 1000
            print(f"[DiipMynd] [{frame_count}] FaceSwapped: Total={t_total:.1f}ms (Det={t_det:.1f}ms, LM={t_lm:.1f}ms, Align={t_align:.1f}ms, Swap={t_swap:.1f}ms, Blend={t_blend:.1f}ms, Enc={t_enc:.1f}ms)")
            
    except WebSocketDisconnect:
        print("[DiipMynd] Web interface disconnected from streaming channel.")
    except Exception as e:
        print(f"[DiipMynd] Error in streaming loop: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
