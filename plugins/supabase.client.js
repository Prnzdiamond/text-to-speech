import { createClient } from "@supabase/supabase-js"

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig()
    const supabaseUrl = config.public.supabaseUrl
    const supabaseAnonKey = config.public.supabaseAnonKey

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Supabase environment variables are missing")
        return
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Provide the Supabase client to the app
    nuxtApp.provide("supabase", supabase)
})
