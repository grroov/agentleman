import os
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response, JSONResponse
from google import genai
from google.genai import types

app = FastAPI(
    title="ADK Audio to Image Agent",
    description="Agent that listens for audio and generates an image using gemini-3.1-flash-lite"
)

# Initialize the Gemini client. It will automatically pick up the GOOGLE_API_KEY environment variable.
client = genai.Client()

@app.post("/process-audio")
async def process_audio(audio: UploadFile = File(...)):
    import mimetypes
    content_type = audio.content_type
    
    # If curl or the client doesn't send a specific audio mime type, guess from the filename
    if not content_type or content_type == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(audio.filename or "")
        content_type = guessed_type or "audio/mp3" # default fallback
        
    if not content_type.startswith("audio/") and not content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail=f"Uploaded file must be an audio file. Received: {content_type}")
    
    # Read the audio data
    audio_data = await audio.read()
    
    try:
        import base64
        
        # Prompt asking Gemini to analyze the audio and write an image generation prompt
        prompt = (
            "I want you to act as a Prompt Engineer. Generate a detailed system instruction for a [Task]. "
            "When writing this prompt, ensure it is strictly aligned with Google's Responsible AI Principles."
            "This first part of this task is to listen to the provided audio file. "
            "Listen what is happening in the audio landscape and imagine the music as an abstract graphical piece of art. "
            "Pay close attention to the genre, style, and energy level of the audio. "
            "If the audio is not music and instead something like the news, sports, or a talk show then be less abstract with the art. "
            "Write a prompt that can be used to generate an image that closely resembles what you have imagined in this work of art. "
            "CRITICAL INSTRUCTION: To ensure the generated prompt passes Google's Responsible AI filters, you MUST adhere to the following rules: "
            "1. NO REAL PEOPLE: Do not reference specific, real, or historical people. Use generic descriptions instead (e.g., 'a person', 'a musician'). "
            "2. NO COPYRIGHT/TRADEMARKS: Do not mention specific brands, logos, copyrighted characters, or specific artists' styles. "
            "3. NO VIOLENCE OR HARM: Do not include weapons, gore, violence, self-harm, or dangerous activities. "
            "4. NO EXPLICIT CONTENT: Keep the imagery safe for work, avoiding sexual content, nudity, or suggestive themes. "
            "5. NO HATE SPEECH: Do not include offensive, discriminatory, or derogatory content. "
            "Respond ONLY with the image prompt text."
        )
        
        # Prepare the audio part
        audio_part = types.Part.from_bytes(data=audio_data, mime_type=content_type)
        
        # Call the gemini-3.1-flash-lite model to get the prompt
        response = client.models.generate_content(
            model='gemini-3.1-flash-lite-preview',
            contents=[audio_part, prompt],
            config=types.GenerateContentConfig(
                safety_settings=[
                    types.SafetySetting(
                        category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    ),
                    types.SafetySetting(
                        category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    ),
                    types.SafetySetting(
                        category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    ),
                    types.SafetySetting(
                        category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                    ),
                ]
            )
        )
        
        image_prompt = response.text.strip()
        import logging
        logging.error(f"Generated Image Prompt: {image_prompt}")
        
        # Generate the image using Imagen 4
        image_result = client.models.generate_images(
            model='imagen-4.0-fast-generate-001',
            prompt=image_prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/jpeg",
                aspect_ratio="1:1",
                #person_generation="DONT_ALLOW"
            )
        )
        
        # Get the generated image bytes and encode to base64
        generated_image = image_result.generated_images[0]
        image_base64 = base64.b64encode(generated_image.image.image_bytes).decode('utf-8')
        
        # Return both the prompt and the base64-encoded image
        return JSONResponse(content={
            "prompt": image_prompt,
            "image": image_base64
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")

@app.get("/health")
def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    # Run the web service
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
