export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_metrics_daily: {
        Row: {
          account_id: string
          clicks: number | null
          comments: number | null
          day: string
          followers: number | null
          followers_gained: number | null
          followers_lost: number | null
          id: string
          impressions: number | null
          interactions: number | null
          likes: number | null
          platform: string | null
          reach: number | null
          saves: number | null
          shares: number | null
          synced_at: string
          username: string | null
          views: number | null
        }
        Insert: {
          account_id: string
          clicks?: number | null
          comments?: number | null
          day: string
          followers?: number | null
          followers_gained?: number | null
          followers_lost?: number | null
          id?: string
          impressions?: number | null
          interactions?: number | null
          likes?: number | null
          platform?: string | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          synced_at?: string
          username?: string | null
          views?: number | null
        }
        Update: {
          account_id?: string
          clicks?: number | null
          comments?: number | null
          day?: string
          followers?: number | null
          followers_gained?: number | null
          followers_lost?: number | null
          id?: string
          impressions?: number | null
          interactions?: number | null
          likes?: number | null
          platform?: string | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          synced_at?: string
          username?: string | null
          views?: number | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          job_id: string | null
          status: string
          trigger_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          job_id?: string | null
          status: string
          trigger_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          job_id?: string | null
          status?: string
          trigger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "automation_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_triggers: {
        Row: {
          account_id: string | null
          budget_credits: number | null
          created_at: string
          created_by: string | null
          enabled: boolean
          family: string
          id: string
          last_run_at: string | null
          name: string
          per_day: number
          source: string
          theme: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          budget_credits?: number | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          family: string
          id?: string
          last_run_at?: string | null
          name: string
          per_day?: number
          source?: string
          theme?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          budget_credits?: number | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          family?: string
          id?: string
          last_run_at?: string | null
          name?: string
          per_day?: number
          source?: string
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      brand_avatars: {
        Row: {
          appearance_prompt: string | null
          created_at: string
          created_by: string | null
          gender: string | null
          id: string
          identity_pack_paths: string[]
          is_default: boolean
          name: string
          provider_refs: Json
          reference_image_path: string | null
          status: string
          updated_at: string
          versions: Json
          voice: Json
        }
        Insert: {
          appearance_prompt?: string | null
          created_at?: string
          created_by?: string | null
          gender?: string | null
          id?: string
          identity_pack_paths?: string[]
          is_default?: boolean
          name: string
          provider_refs?: Json
          reference_image_path?: string | null
          status?: string
          updated_at?: string
          versions?: Json
          voice?: Json
        }
        Update: {
          appearance_prompt?: string | null
          created_at?: string
          created_by?: string | null
          gender?: string | null
          id?: string
          identity_pack_paths?: string[]
          is_default?: boolean
          name?: string
          provider_refs?: Json
          reference_image_path?: string | null
          status?: string
          updated_at?: string
          versions?: Json
          voice?: Json
        }
        Relationships: []
      }
      brand_kit: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      brand_persona: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      brand_strategy: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      brand_voices: {
        Row: {
          attempt: number
          consent_at: string | null
          consent_by: string | null
          created_at: string
          created_by: string | null
          error: string | null
          gender: string | null
          id: string
          is_default: boolean
          language: string
          name: string
          owned: boolean
          preview_path: string | null
          provider: string
          provider_voice_id: string | null
          sample_path: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          consent_at?: string | null
          consent_by?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          gender?: string | null
          id?: string
          is_default?: boolean
          language?: string
          name: string
          owned?: boolean
          preview_path?: string | null
          provider: string
          provider_voice_id?: string | null
          sample_path?: string | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          consent_at?: string | null
          consent_by?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          gender?: string | null
          id?: string
          is_default?: boolean
          language?: string
          name?: string
          owned?: boolean
          preview_path?: string | null
          provider?: string
          provider_voice_id?: string | null
          sample_path?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          type?: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Relationships: []
      }
      competitor_metrics_daily: {
        Row: {
          competitor_id: string
          day: string
          followers: number | null
          synced_at: string
        }
        Insert: {
          competitor_id: string
          day: string
          followers?: number | null
          synced_at?: string
        }
        Update: {
          competitor_id?: string
          day?: string
          followers?: number | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_metrics_daily_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_posts: {
        Row: {
          angle: string | null
          caption: string | null
          comments: number | null
          competitor_id: string
          engagement: number | null
          fetched_at: string
          id: string
          likes: number | null
          media_type: string | null
          platform_post_id: string
          posted_at: string | null
          relevance: number | null
          score_reason: string | null
          scored_at: string | null
          thumbnail_url: string | null
          topics: string[]
          url: string | null
          views: number | null
          virality: number | null
        }
        Insert: {
          angle?: string | null
          caption?: string | null
          comments?: number | null
          competitor_id: string
          engagement?: number | null
          fetched_at?: string
          id?: string
          likes?: number | null
          media_type?: string | null
          platform_post_id: string
          posted_at?: string | null
          relevance?: number | null
          score_reason?: string | null
          scored_at?: string | null
          thumbnail_url?: string | null
          topics?: string[]
          url?: string | null
          views?: number | null
          virality?: number | null
        }
        Update: {
          angle?: string | null
          caption?: string | null
          comments?: number | null
          competitor_id?: string
          engagement?: number | null
          fetched_at?: string
          id?: string
          likes?: number | null
          media_type?: string | null
          platform_post_id?: string
          posted_at?: string | null
          relevance?: number | null
          score_reason?: string | null
          scored_at?: string | null
          thumbnail_url?: string | null
          topics?: string[]
          url?: string | null
          views?: number | null
          virality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_posts_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          avatar_url: string | null
          created_at: string
          enabled: boolean
          followers: number | null
          handle: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          name: string | null
          platform: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          enabled?: boolean
          followers?: number | null
          handle: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          name?: string | null
          platform?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          enabled?: boolean
          followers?: number | null
          handle?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          name?: string | null
          platform?: string
        }
        Relationships: []
      }
      content_pieces: {
        Row: {
          adapted_content: Json
          audit: Json
          brand_kit_version: number | null
          channel_type: Database["public"]["Enums"]["channel_type"]
          context_ids: string[]
          core_content: Json
          created_at: string
          engine_version: string | null
          guardrails_version: number | null
          id: string
          job_id: string
          persona_version: number | null
          render_path: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["piece_status"]
          strategy_version: number | null
          updated_at: string
        }
        Insert: {
          adapted_content?: Json
          audit?: Json
          brand_kit_version?: number | null
          channel_type: Database["public"]["Enums"]["channel_type"]
          context_ids?: string[]
          core_content?: Json
          created_at?: string
          engine_version?: string | null
          guardrails_version?: number | null
          id?: string
          job_id: string
          persona_version?: number | null
          render_path?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["piece_status"]
          strategy_version?: number | null
          updated_at?: string
        }
        Update: {
          adapted_content?: Json
          audit?: Json
          brand_kit_version?: number | null
          channel_type?: Database["public"]["Enums"]["channel_type"]
          context_ids?: string[]
          core_content?: Json
          created_at?: string
          engine_version?: string | null
          guardrails_version?: number | null
          id?: string
          job_id?: string
          persona_version?: number | null
          render_path?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["piece_status"]
          strategy_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      context_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          id: string
          item_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          item_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_chunks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "context_items"
            referencedColumns: ["id"]
          },
        ]
      }
      context_items: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          file_path: string | null
          id: string
          kind: Database["public"]["Enums"]["context_kind"]
          metadata: Json
          search: unknown
          source_url: string | null
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          kind: Database["public"]["Enums"]["context_kind"]
          metadata?: Json
          search?: unknown
          source_url?: string | null
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["context_kind"]
          metadata?: Json
          search?: unknown
          source_url?: string | null
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      director_identities: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          error: string | null
          hf_element_id: string | null
          hf_media_ids: Json
          id: string
          image_paths: Json
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          hf_element_id?: string | null
          hf_media_ids?: Json
          id?: string
          image_paths?: Json
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          hf_element_id?: string | null
          hf_media_ids?: Json
          id?: string
          image_paths?: Json
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      director_jobs: {
        Row: {
          artifacts: Json
          brief: Json
          claimed_at: string | null
          claimed_by: string | null
          config: Json
          costs: Json
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          plan: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          artifacts?: Json
          brief: Json
          claimed_at?: string | null
          claimed_by?: string | null
          config?: Json
          costs?: Json
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          plan?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          artifacts?: Json
          brief?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          config?: Json
          costs?: Json
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          plan?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      director_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      drive_files: {
        Row: {
          archived_at: string | null
          attempts: number
          bucket: string
          claimed_at: string | null
          created_at: string
          drive_account: string | null
          drive_email: string | null
          drive_file_id: string | null
          drive_link: string | null
          hash_state: Json | null
          id: string
          kind: string
          last_error: string | null
          last_used_at: string | null
          md5: string | null
          mime_type: string | null
          next_try_at: string
          path: string
          purged_at: string | null
          reason: string | null
          restored_at: string | null
          session_uri: string | null
          size_bytes: number
          source_etag: string | null
          source_updated_at: string | null
          status: string
          tus_url: string | null
          updated_at: string
          uploaded_bytes: number
        }
        Insert: {
          archived_at?: string | null
          attempts?: number
          bucket: string
          claimed_at?: string | null
          created_at?: string
          drive_account?: string | null
          drive_email?: string | null
          drive_file_id?: string | null
          drive_link?: string | null
          hash_state?: Json | null
          id?: string
          kind?: string
          last_error?: string | null
          last_used_at?: string | null
          md5?: string | null
          mime_type?: string | null
          next_try_at?: string
          path: string
          purged_at?: string | null
          reason?: string | null
          restored_at?: string | null
          session_uri?: string | null
          size_bytes?: number
          source_etag?: string | null
          source_updated_at?: string | null
          status?: string
          tus_url?: string | null
          updated_at?: string
          uploaded_bytes?: number
        }
        Update: {
          archived_at?: string | null
          attempts?: number
          bucket?: string
          claimed_at?: string | null
          created_at?: string
          drive_account?: string | null
          drive_email?: string | null
          drive_file_id?: string | null
          drive_link?: string | null
          hash_state?: Json | null
          id?: string
          kind?: string
          last_error?: string | null
          last_used_at?: string | null
          md5?: string | null
          mime_type?: string | null
          next_try_at?: string
          path?: string
          purged_at?: string | null
          reason?: string | null
          restored_at?: string | null
          session_uri?: string | null
          size_bytes?: number
          source_etag?: string | null
          source_updated_at?: string | null
          status?: string
          tus_url?: string | null
          updated_at?: string
          uploaded_bytes?: number
        }
        Relationships: []
      }
      editorial_state: {
        Row: {
          id: number
          state: Json
          updated_at: string
        }
        Insert: {
          id?: number
          state?: Json
          updated_at?: string
        }
        Update: {
          id?: number
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      generation_jobs: {
        Row: {
          attempt: number
          classification: Json | null
          context_ids: string[]
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          prompt: string
          selected_angle: Json | null
          status: Database["public"]["Enums"]["job_status"]
          timings: Json
          updated_at: string
          web_research: Json | null
        }
        Insert: {
          attempt?: number
          classification?: Json | null
          context_ids?: string[]
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          prompt: string
          selected_angle?: Json | null
          status?: Database["public"]["Enums"]["job_status"]
          timings?: Json
          updated_at?: string
          web_research?: Json | null
        }
        Update: {
          attempt?: number
          classification?: Json | null
          context_ids?: string[]
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          prompt?: string
          selected_angle?: Json | null
          status?: Database["public"]["Enums"]["job_status"]
          timings?: Json
          updated_at?: string
          web_research?: Json | null
        }
        Relationships: []
      }
      guardrails: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      mcp_oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          created_at: string
          redirect_uris: string[]
        }
        Insert: {
          client_id?: string
          client_name: string
          created_at?: string
          redirect_uris: string[]
        }
        Update: {
          client_id?: string
          client_name?: string
          created_at?: string
          redirect_uris?: string[]
        }
        Relationships: []
      }
      mcp_oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_hash: string
          created_at: string
          created_by: string | null
          expires_at: string
          redirect_uri: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_hash: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          redirect_uri: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_hash?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          redirect_uri?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      mcp_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          hint: string
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hint: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hint?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      niche_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          payload: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          payload?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          payload?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_invites: {
        Row: {
          created_at: string
          email: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      piece_feedback: {
        Row: {
          created_at: string
          created_by: string | null
          edited_diff: Json | null
          id: string
          notes: string | null
          piece_id: string
          verdict: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          edited_diff?: Json | null
          id?: string
          notes?: string | null
          piece_id: string
          verdict: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          edited_diff?: Json | null
          id?: string
          notes?: string | null
          piece_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "piece_feedback_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      post_metrics_daily: {
        Row: {
          account_id: string | null
          clicks: number | null
          comments: number | null
          content: string | null
          day: string
          engagement_rate: number | null
          id: string
          impressions: number | null
          likes: number | null
          media_type: string | null
          piece_id: string | null
          platform: string
          published_at: string | null
          reach: number | null
          saves: number | null
          shares: number | null
          sync_status: string | null
          synced_at: string
          url: string | null
          views: number | null
          zernio_post_id: string
        }
        Insert: {
          account_id?: string | null
          clicks?: number | null
          comments?: number | null
          content?: string | null
          day: string
          engagement_rate?: number | null
          id?: string
          impressions?: number | null
          likes?: number | null
          media_type?: string | null
          piece_id?: string | null
          platform: string
          published_at?: string | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          sync_status?: string | null
          synced_at?: string
          url?: string | null
          views?: number | null
          zernio_post_id: string
        }
        Update: {
          account_id?: string | null
          clicks?: number | null
          comments?: number | null
          content?: string | null
          day?: string
          engagement_rate?: number | null
          id?: string
          impressions?: number | null
          likes?: number | null
          media_type?: string | null
          piece_id?: string | null
          platform?: string
          published_at?: string | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          sync_status?: string | null
          synced_at?: string
          url?: string | null
          views?: number | null
          zernio_post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_daily_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      published_posts: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          piece_id: string
          platform: string
          public_url: string | null
          published_at: string | null
          raw: Json
          request_id: string
          scheduled_for: string | null
          status: Database["public"]["Enums"]["publish_status"]
          updated_at: string
          zernio_post_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          piece_id: string
          platform: string
          public_url?: string | null
          published_at?: string | null
          raw?: Json
          request_id?: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          updated_at?: string
          zernio_post_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          piece_id?: string
          platform?: string
          public_url?: string | null
          published_at?: string | null
          raw?: Json
          request_id?: string
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          updated_at?: string
          zernio_post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_posts_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      roteiro_pedidos: {
        Row: {
          aguardando_pessoa: boolean
          andamento: Json | null
          briefing: string
          claim: Json | null
          contexto: Json
          conversa: Json
          created_at: string
          created_by: string | null
          erro: string | null
          id: string
          plano: Json | null
          referencias: Json
          roteiro: string | null
          saida: Json | null
          status: string
          tipo: string
          updated_at: string
        }
        Insert: {
          aguardando_pessoa?: boolean
          andamento?: Json | null
          briefing: string
          claim?: Json | null
          contexto?: Json
          conversa?: Json
          created_at?: string
          created_by?: string | null
          erro?: string | null
          id?: string
          plano?: Json | null
          referencias?: Json
          roteiro?: string | null
          saida?: Json | null
          status?: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          aguardando_pessoa?: boolean
          andamento?: Json | null
          briefing?: string
          claim?: Json | null
          contexto?: Json
          conversa?: Json
          created_at?: string
          created_by?: string | null
          erro?: string | null
          id?: string
          plano?: Json | null
          referencias?: Json
          roteiro?: string | null
          saida?: Json | null
          status?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      rss_feeds: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_error: string | null
          last_error_at: string | null
          last_fetched_at: string | null
          last_item_count: number | null
          last_ok_at: string | null
          name: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_fetched_at?: string | null
          last_item_count?: number | null
          last_ok_at?: string | null
          name: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_fetched_at?: string | null
          last_item_count?: number | null
          last_ok_at?: string | null
          name?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      rss_items: {
        Row: {
          created_at: string
          description: string | null
          dismissed_at: string | null
          feed_id: string
          guid: string
          id: string
          link: string
          priority: number | null
          published_at: string | null
          relevance: number | null
          score_reason: string | null
          scored_at: string | null
          title: string
          topics: string[]
          used_in_job_id: string | null
          virality: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          dismissed_at?: string | null
          feed_id: string
          guid: string
          id?: string
          link: string
          priority?: number | null
          published_at?: string | null
          relevance?: number | null
          score_reason?: string | null
          scored_at?: string | null
          title: string
          topics?: string[]
          used_in_job_id?: string | null
          virality?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          dismissed_at?: string | null
          feed_id?: string
          guid?: string
          id?: string
          link?: string
          priority?: number | null
          published_at?: string | null
          relevance?: number | null
          score_reason?: string | null
          scored_at?: string | null
          title?: string
          topics?: string[]
          used_in_job_id?: string | null
          virality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rss_items_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "rss_feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rss_items_used_in_job_id_fkey"
            columns: ["used_in_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          action: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_edits: {
        Row: {
          analysis: Json
          artifacts: Json
          auto: boolean
          claimed_at: string | null
          claimed_by: string | null
          cost_usd: number
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          output_path: string | null
          plan: Json | null
          qa: Json | null
          source_id: string | null
          source_kind: string
          source_path: string
          status: string
          updated_at: string
        }
        Insert: {
          analysis?: Json
          artifacts?: Json
          auto?: boolean
          claimed_at?: string | null
          claimed_by?: string | null
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          output_path?: string | null
          plan?: Json | null
          qa?: Json | null
          source_id?: string | null
          source_kind: string
          source_path: string
          status?: string
          updated_at?: string
        }
        Update: {
          analysis?: Json
          artifacts?: Json
          auto?: boolean
          claimed_at?: string | null
          claimed_by?: string | null
          cost_usd?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          output_path?: string | null
          plan?: Json | null
          qa?: Json | null
          source_id?: string | null
          source_kind?: string
          source_path?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_edits_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "director_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_models: {
        Row: {
          active: boolean
          capability: string
          cost: Json
          cost_verified_at: string | null
          created_at: string
          experience: string[]
          fallback_model_id: string | null
          id: string
          input_template: Json
          is_primary: boolean
          kind: string
          label: string | null
          last_validated_at: string | null
          limits: Json
          model_id: string
          notes: string | null
          provider: string
          required_inputs: string[]
          retired_reason: string | null
          tier: string | null
          updated_at: string
          version_hash: string | null
        }
        Insert: {
          active?: boolean
          capability: string
          cost?: Json
          cost_verified_at?: string | null
          created_at?: string
          experience?: string[]
          fallback_model_id?: string | null
          id?: string
          input_template?: Json
          is_primary?: boolean
          kind: string
          label?: string | null
          last_validated_at?: string | null
          limits?: Json
          model_id: string
          notes?: string | null
          provider?: string
          required_inputs?: string[]
          retired_reason?: string | null
          tier?: string | null
          updated_at?: string
          version_hash?: string | null
        }
        Update: {
          active?: boolean
          capability?: string
          cost?: Json
          cost_verified_at?: string | null
          created_at?: string
          experience?: string[]
          fallback_model_id?: string | null
          id?: string
          input_template?: Json
          is_primary?: boolean
          kind?: string
          label?: string | null
          last_validated_at?: string | null
          limits?: Json
          model_id?: string
          notes?: string | null
          provider?: string
          required_inputs?: string[]
          retired_reason?: string | null
          tier?: string | null
          updated_at?: string
          version_hash?: string | null
        }
        Relationships: []
      }
      video_predictions: {
        Row: {
          attempt: number
          avatar_id: string | null
          cost_actual_usd: number | null
          cost_estimated_usd: number | null
          created_at: string
          created_by: string | null
          error: string | null
          error_code: string | null
          fallback_of: string | null
          id: string
          input: Json
          input_fingerprint: string | null
          kind: Database["public"]["Enums"]["video_prediction_kind"]
          last_checked_at: string | null
          model_id: string
          output_path: string | null
          project_id: string | null
          provider: string
          provider_prediction_id: string | null
          provider_version: string | null
          scene_id: string | null
          status: Database["public"]["Enums"]["video_prediction_status"]
          submitted_at: string | null
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          attempt?: number
          avatar_id?: string | null
          cost_actual_usd?: number | null
          cost_estimated_usd?: number | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          error_code?: string | null
          fallback_of?: string | null
          id?: string
          input?: Json
          input_fingerprint?: string | null
          kind: Database["public"]["Enums"]["video_prediction_kind"]
          last_checked_at?: string | null
          model_id: string
          output_path?: string | null
          project_id?: string | null
          provider?: string
          provider_prediction_id?: string | null
          provider_version?: string | null
          scene_id?: string | null
          status?: Database["public"]["Enums"]["video_prediction_status"]
          submitted_at?: string | null
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt?: number
          avatar_id?: string | null
          cost_actual_usd?: number | null
          cost_estimated_usd?: number | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          error_code?: string | null
          fallback_of?: string | null
          id?: string
          input?: Json
          input_fingerprint?: string | null
          kind?: Database["public"]["Enums"]["video_prediction_kind"]
          last_checked_at?: string | null
          model_id?: string
          output_path?: string | null
          project_id?: string | null
          provider?: string
          provider_prediction_id?: string | null
          provider_version?: string | null
          scene_id?: string | null
          status?: Database["public"]["Enums"]["video_prediction_status"]
          submitted_at?: string | null
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_predictions_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "brand_avatars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_predictions_fallback_of_fkey"
            columns: ["fallback_of"]
            isOneToOne: false
            referencedRelation: "video_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_predictions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_predictions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "video_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      video_projects: {
        Row: {
          actual_cost_usd: number
          avatar_id: string | null
          created_at: string
          created_by: string | null
          error: string | null
          error_code: string | null
          estimated_cost_usd: number | null
          final_meta: Json
          final_video_path: string | null
          id: string
          piece_id: string
          resolution: string
          settings: Json
          status: Database["public"]["Enums"]["video_project_status"]
          style_bible: string | null
          updated_at: string
        }
        Insert: {
          actual_cost_usd?: number
          avatar_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          final_meta?: Json
          final_video_path?: string | null
          id?: string
          piece_id: string
          resolution?: string
          settings?: Json
          status?: Database["public"]["Enums"]["video_project_status"]
          style_bible?: string | null
          updated_at?: string
        }
        Update: {
          actual_cost_usd?: number
          avatar_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          final_meta?: Json
          final_video_path?: string | null
          id?: string
          piece_id?: string
          resolution?: string
          settings?: Json
          status?: Database["public"]["Enums"]["video_project_status"]
          style_bible?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_projects_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "brand_avatars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_projects_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: true
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
        ]
      }
      video_scenes: {
        Row: {
          audio_duration_s: number | null
          audio_path: string | null
          beat_index: number
          continuity: Json
          cost_usd: number
          created_at: string
          duration_target_s: number
          error: string | null
          final_path: string | null
          id: string
          keyframe_path: string | null
          model_overrides: Json
          narration: string
          narration_diverged: boolean
          narration_hash: string | null
          on_screen_text: string | null
          project_id: string
          role: string
          scene_index: number
          shot_angle: string | null
          shot_function: string | null
          shot_index: number
          shot_lens: string | null
          shot_movement: string | null
          shot_size: string | null
          status: Database["public"]["Enums"]["video_scene_status"]
          transition: string
          type: string
          updated_at: string
          video_path: string | null
          visual_prompt: string
        }
        Insert: {
          audio_duration_s?: number | null
          audio_path?: string | null
          beat_index: number
          continuity?: Json
          cost_usd?: number
          created_at?: string
          duration_target_s: number
          error?: string | null
          final_path?: string | null
          id?: string
          keyframe_path?: string | null
          model_overrides?: Json
          narration: string
          narration_diverged?: boolean
          narration_hash?: string | null
          on_screen_text?: string | null
          project_id: string
          role: string
          scene_index: number
          shot_angle?: string | null
          shot_function?: string | null
          shot_index?: number
          shot_lens?: string | null
          shot_movement?: string | null
          shot_size?: string | null
          status?: Database["public"]["Enums"]["video_scene_status"]
          transition?: string
          type: string
          updated_at?: string
          video_path?: string | null
          visual_prompt: string
        }
        Update: {
          audio_duration_s?: number | null
          audio_path?: string | null
          beat_index?: number
          continuity?: Json
          cost_usd?: number
          created_at?: string
          duration_target_s?: number
          error?: string | null
          final_path?: string | null
          id?: string
          keyframe_path?: string | null
          model_overrides?: Json
          narration?: string
          narration_diverged?: boolean
          narration_hash?: string | null
          on_screen_text?: string | null
          project_id?: string
          role?: string
          scene_index?: number
          shot_angle?: string | null
          shot_function?: string | null
          shot_index?: number
          shot_lens?: string | null
          shot_movement?: string | null
          shot_size?: string | null
          status?: Database["public"]["Enums"]["video_scene_status"]
          transition?: string
          type?: string
          updated_at?: string
          video_path?: string | null
          visual_prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "video_projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_editorial_use: {
        Args: { _entry: Json; _max?: number }
        Returns: undefined
      }
      claim_context_ingest: {
        Args: { _item_id: string; _stale_minutes?: number }
        Returns: boolean
      }
      claim_director_job: {
        Args: { p_worker: string }
        Returns: {
          artifacts: Json
          brief: Json
          claimed_at: string | null
          claimed_by: string | null
          config: Json
          costs: Json
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          plan: Json | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "director_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_slide_images_batch: {
        Args: { _job: Json; _piece_id: string; _stale_minutes?: number }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: { _action: string; _user_id: string }
        Returns: Json
      }
      get_vault_secret: { Args: { _name: string }; Returns: string }
      google_drive_candidates: {
        Args: {
          _buckets: string[]
          _limit: number
          _min_age: string
          _min_size: number
        }
        Returns: {
          bucket: string
          etag: string
          known: boolean
          mime_type: string
          path: string
          size_bytes: number
          source_updated_at: string
        }[]
      }
      google_drive_object: {
        Args: { _bucket: string; _path: string }
        Returns: {
          etag: string
          mime_type: string
          size_bytes: number
          source_updated_at: string
        }[]
      }
      google_drive_objects_seen: {
        Args: { _buckets: string[] }
        Returns: number
      }
      google_drive_required: { Args: never; Returns: boolean }
      google_drive_stats: {
        Args: never
        Returns: {
          drive_files: number
          failing_files: number
          saved_bytes: number
          saved_files: number
          waiting_files: number
        }[]
      }
      google_drive_store_refresh: {
        Args: { _value: string }
        Returns: undefined
      }
      google_drive_touch: {
        Args: { _bucket: string; _path: string }
        Returns: undefined
      }
      has_any_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_automation_tick: { Args: never; Returns: number }
      invoke_director_advance: { Args: never; Returns: number }
      invoke_fetch_rss: { Args: never; Returns: number }
      invoke_google_drive_tick: { Args: never; Returns: number }
      invoke_market_sync: { Args: never; Returns: number }
      invoke_metrics_sync: { Args: never; Returns: number }
      invoke_video_edit_tick: { Args: never; Returns: number }
      invoke_video_reconcile: { Args: never; Returns: number }
      mark_stale_jobs_failed: { Args: never; Returns: number }
      mark_stale_video_edits_failed: { Args: never; Returns: undefined }
      mark_stale_video_predictions_failed: { Args: never; Returns: number }
      match_context_chunks:
        | {
            Args: {
              filter_kinds?: Database["public"]["Enums"]["context_kind"][]
              filter_tags?: string[]
              match_count?: number
              query_embedding: string
            }
            Returns: {
              chunk_id: string
              content: string
              item_id: string
              similarity: number
            }[]
          }
        | {
            Args: {
              exclude_tags?: string[]
              filter_kinds?: Database["public"]["Enums"]["context_kind"][]
              filter_tags?: string[]
              match_count?: number
              query_embedding: string
            }
            Returns: {
              chunk_id: string
              content: string
              item_id: string
              similarity: number
            }[]
          }
      merge_piece_adapted_content: {
        Args: { _patch: Json; _piece_id: string }
        Returns: boolean
      }
      purge_old_usage_events: { Args: never; Returns: number }
      reorder_video_scenes: {
        Args: { _order: string[]; _project_id: string }
        Returns: undefined
      }
      search_context_items_fts: {
        Args: {
          exclude_tags?: string[]
          filter_kinds?: Database["public"]["Enums"]["context_kind"][]
          filter_tags?: string[]
          match_count?: number
          query_text: string
        }
        Returns: {
          item_id: string
          rank: number
        }[]
      }
      store_vault_secret: {
        Args: { _name: string; _value: string }
        Returns: undefined
      }
      vault_fechado: { Args: never; Returns: boolean }
      video_month_spend_usd: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      channel_type:
        | "instagram_stories"
        | "instagram_carousel"
        | "instagram_post"
        | "x_post"
        | "threads_post"
        | "linkedin_post"
        | "facebook_post"
        | "instagram_reel"
      context_kind:
        | "transcript"
        | "post"
        | "document"
        | "reference"
        | "case"
        | "offer"
      job_status:
        | "created"
        | "classifying"
        | "awaiting_angle"
        | "retrieving"
        | "researching"
        | "generating"
        | "linting"
        | "grounding"
        | "judging"
        | "rewriting"
        | "adapting"
        | "awaiting_review"
        | "done"
        | "failed"
        | "cancelled"
      piece_status: "draft" | "approved" | "rejected" | "archived" | "published"
      publish_status:
        | "pending"
        | "scheduled"
        | "publishing"
        | "published"
        | "partial"
        | "failed"
        | "cancelled"
      video_prediction_kind:
        | "tts"
        | "keyframe"
        | "avatar_identity"
        | "scene_video"
        | "normalize"
        | "concat"
        | "audio_merge"
      video_prediction_status:
        | "queued"
        | "submitted"
        | "processing"
        | "downloading"
        | "succeeded"
        | "failed"
        | "canceled"
      video_project_status:
        | "storyboard"
        | "generating_audio"
        | "keyframes_review"
        | "generating_scenes"
        | "scenes_ready"
        | "assembling"
        | "ready"
        | "attention"
        | "paused"
        | "failed"
        | "cancelled"
      video_scene_status:
        | "planned"
        | "generating_audio"
        | "generating_keyframe"
        | "keyframe_ready"
        | "generating_video"
        | "ready"
        | "stale"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      channel_type: [
        "instagram_stories",
        "instagram_carousel",
        "instagram_post",
        "x_post",
        "threads_post",
        "linkedin_post",
        "facebook_post",
        "instagram_reel",
      ],
      context_kind: [
        "transcript",
        "post",
        "document",
        "reference",
        "case",
        "offer",
      ],
      job_status: [
        "created",
        "classifying",
        "awaiting_angle",
        "retrieving",
        "researching",
        "generating",
        "linting",
        "grounding",
        "judging",
        "rewriting",
        "adapting",
        "awaiting_review",
        "done",
        "failed",
        "cancelled",
      ],
      piece_status: ["draft", "approved", "rejected", "archived", "published"],
      publish_status: [
        "pending",
        "scheduled",
        "publishing",
        "published",
        "partial",
        "failed",
        "cancelled",
      ],
      video_prediction_kind: [
        "tts",
        "keyframe",
        "avatar_identity",
        "scene_video",
        "normalize",
        "concat",
        "audio_merge",
      ],
      video_prediction_status: [
        "queued",
        "submitted",
        "processing",
        "downloading",
        "succeeded",
        "failed",
        "canceled",
      ],
      video_project_status: [
        "storyboard",
        "generating_audio",
        "keyframes_review",
        "generating_scenes",
        "scenes_ready",
        "assembling",
        "ready",
        "attention",
        "paused",
        "failed",
        "cancelled",
      ],
      video_scene_status: [
        "planned",
        "generating_audio",
        "generating_keyframe",
        "keyframe_ready",
        "generating_video",
        "ready",
        "stale",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
