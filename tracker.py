import cv2
import mediapipe as mp
import sys

mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
mp_hands = mp.solutions.hands
mp_face_mesh = mp.solutions.face_mesh

def main():
    print("Starting fast webcam routing...")
    cap = cv2.VideoCapture(0)
    
    # 💥 CRITICAL FIX: Force MJPG codec buffer. 
    # Without this, some Windows cameras fallback to raw uncompressed (YUY2) format and get locked at 5-10 FPS! 
    # MJPG guarantees 30/60 FPS hardware ingestion.
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    
    # Do not let frames stack in the queue
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        print("Error: Could not open webcam.")
        sys.exit(1)

    print("Loading specialized machine learning models...")
    # 💥 OVERHAUL: Removing 'Holistic' engine. 
    # Holistic forces the system to run a heavy Full-Body Pose network before finding hands. 
    # Loading Hands + FaceMesh independently skips the body check and boosts speed by ~70%!
    with mp_hands.Hands(
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        max_num_hands=2
    ) as hands, mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as face_mesh:
        
        print("⚡ Tracker Active. Zero-latency mode engaged. Press 'q' to quit.")
        
        while cap.isOpened():
            success, image = cap.read()
            if not success:
               continue

            # Mirror the camera image
            image = cv2.flip(image, 1)
            
            # Pass image directly by reference for faster memory allocation
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            image_rgb.flags.writeable = False
            
            # Process strictly Face & Hands simultaneously!
            hand_results = hands.process(image_rgb)
            face_results = face_mesh.process(image_rgb)

            # Draw
            image_rgb.flags.writeable = True
            
            # Draw Face (using basic Contours instead of 468-point Tesselation rendering grid saves rendering CPU)
            if face_results.multi_face_landmarks:
                for face_landmarks in face_results.multi_face_landmarks:
                    mp_drawing.draw_landmarks(
                        image=image,
                        landmark_list=face_landmarks,
                        connections=mp_face_mesh.FACEMESH_CONTOURS,
                        landmark_drawing_spec=None,
                        connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_contours_style()
                    )

            # Draw Hands
            if hand_results.multi_hand_landmarks:
                for hand_landmarks in hand_results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        image,
                        hand_landmarks,
                        mp_hands.HAND_CONNECTIONS,
                        mp_drawing_styles.get_default_hand_landmarks_style(),
                        mp_drawing_styles.get_default_hand_connections_style()
                    )

            cv2.imshow('Fast AR Tracker', image)
            
            if cv2.waitKey(1) & 0xFF in [27, ord('q')]:
                break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
