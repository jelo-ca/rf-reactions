// Camera stream + device picker (PLAN.md §5.1).
// Mirroring pitfall: if the preview is mirrored, mirror with CSS only — always crop from the raw frame.
import { useEffect, useState } from "react";
import { CFG } from "../config";

export interface CameraState {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  error: string | null;
}

export function useCamera(deviceId: string | null): CameraState {
  const [state, setState] = useState<CameraState>({ stream: null, devices: [], error: null });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const video: MediaTrackConstraints = {
      width: { ideal: CFG.CAMERA_IDEAL_W },
      height: { ideal: CFG.CAMERA_IDEAL_H },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
    };

    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        // Device labels are only populated after permission is granted.
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (!cancelled) setState({ stream: s, devices, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((prev) => ({ ...prev, stream: null, error: describeError(e) }));
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  return state;
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") return "Camera permission denied. Allow camera access and reload.";
    if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "Camera not found.";
    if (e.name === "NotReadableError") return "Camera is in use by another app.";
    return `${e.name}: ${e.message}`;
  }
  return String(e);
}
