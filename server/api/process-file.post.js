import fs from "fs"
import path from "path"
import os from "os"
import pdfParse from "pdf-parse"
import mammoth from "mammoth"
import { defineEventHandler, readMultipartFormData, setHeader, getMethod } from 'h3'

export default defineEventHandler(async (event) => {
    try {
        console.log("API route called - processing file upload")

        // Set CORS headers
        setHeader(event, 'Access-Control-Allow-Origin', '*')
        setHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS')
        setHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')

        // Handle preflight requests
        if (getMethod(event) === 'OPTIONS') {
            return ''
        }

        // Read multipart form data
        const formData = await readMultipartFormData(event)
        console.log("Form data received:", formData ? formData.length : 0, "fields")

        if (!formData || formData.length === 0) {
            console.log("No form data found")
            return { success: false, error: "No file uploaded" }
        }

        // Find the file field
        const fileField = formData.find((field) => field.name === "file")
        console.log("File field found:", !!fileField)

        if (!fileField || !fileField.data) {
            console.log("No file data found in form")
            return { success: false, error: "No file data found" }
        }

        const originalName = fileField.filename || "unknown"
        const fileExtension = path.extname(originalName).toLowerCase()
        const fileBuffer = fileField.data

        console.log("Processing file:", originalName)
        console.log("File extension:", fileExtension)
        console.log("Buffer size:", fileBuffer.length, "bytes")

        // Validate file type
        const allowedTypes = [".pdf", ".docx", ".txt"]
        if (!allowedTypes.includes(fileExtension)) {
            return {
                success: false,
                error: `Unsupported file type: ${fileExtension}. Please upload PDF, DOCX, or TXT files.`,
            }
        }

        // Validate file size (10MB limit)
        if (fileBuffer.length > 10 * 1024 * 1024) {
            return {
                success: false,
                error: "File size must be less than 10MB.",
            }
        }

        let extractedText = ""

        try {
            switch (fileExtension) {
                case ".pdf":
                    console.log("Processing PDF file...")
                    try {
                        const pdfData = await pdfParse(fileBuffer)
                        extractedText = pdfData.text
                        console.log("PDF processed successfully")
                    } catch (pdfError) {
                        console.error("PDF parsing error:", pdfError.message)
                        return {
                            success: false,
                            error: `PDF processing failed: ${pdfError.message}`,
                        }
                    }
                    break

                case ".docx":
                    console.log("Processing DOCX file...")
                    try {
                        const docxResult = await mammoth.extractRawText({ buffer: fileBuffer })
                        extractedText = docxResult.value
                        console.log("DOCX processed successfully")
                    } catch (docxError) {
                        console.error("DOCX parsing error:", docxError.message)
                        return {
                            success: false,
                            error: `DOCX processing failed: ${docxError.message}`,
                        }
                    }
                    break

                case ".txt":
                    console.log("Processing TXT file...")
                    try {
                        extractedText = fileBuffer.toString("utf8")
                        console.log("TXT processed successfully")
                    } catch (txtError) {
                        console.error("TXT parsing error:", txtError.message)
                        return {
                            success: false,
                            error: `TXT processing failed: ${txtError.message}`,
                        }
                    }
                    break

                default:
                    return {
                        success: false,
                        error: `Unsupported file type: ${fileExtension}`,
                    }
            }

            // Clean up the extracted text
            extractedText = extractedText.trim().replace(/\s+/g, " ")

            if (!extractedText) {
                return {
                    success: false,
                    error: "No text could be extracted from the file. The file might be empty or corrupted.",
                }
            }

            console.log("Text extracted successfully, length:", extractedText.length)

            return {
                success: true,
                text: extractedText,
                filename: originalName,
                fileType: fileExtension,
            }
        } catch (processingError) {
            console.error("File processing error:", processingError)
            return {
                success: false,
                error: `Error processing ${fileExtension} file: ${processingError.message}`,
            }
        }
    } catch (error) {
        console.error("Upload handling error:", error)
        return {
            success: false,
            error: "Error handling file upload: " + error.message,
        }
    }
})
