export const useRuntimeConfig = () => {
    return {
        public: {
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
            supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
    }
}

export const defineNuxtPlugin = (plugin) => {
    return plugin
}
