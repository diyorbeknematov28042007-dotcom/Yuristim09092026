export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      admin_accounts: {
        Row: {
          created_at: string;
          failed_login_attempts: number;
          id: string;
          last_login_at: string | null;
          locked_until: string | null;
          password_hash: string;
          role: string;
          status: string;
          updated_at: string;
          username: string;
        };
        Insert: {
          created_at?: string;
          failed_login_attempts?: number;
          id?: string;
          last_login_at?: string | null;
          locked_until?: string | null;
          password_hash: string;
          role?: string;
          status?: string;
          updated_at?: string;
          username: string;
        };
        Update: {
          created_at?: string;
          failed_login_attempts?: number;
          id?: string;
          last_login_at?: string | null;
          locked_until?: string | null;
          password_hash?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          username?: string;
        };
        Relationships: [];
      };
      admin_login_logs: {
        Row: {
          admin_id: string | null;
          created_at: string;
          id: string;
          ip: unknown;
          success: boolean;
          user_agent: string | null;
          username: string;
        };
        Insert: {
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: unknown;
          success: boolean;
          user_agent?: string | null;
          username: string;
        };
        Update: {
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: unknown;
          success?: boolean;
          user_agent?: string | null;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_login_logs_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin_accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_sessions: {
        Row: {
          admin_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          last_seen_at: string;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          admin_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_seen_at?: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_seen_at?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_sessions_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin_accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      auth_login_requests: {
        Row: {
          challenge_hash: string;
          confirmed_at: string | null;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          challenge_hash: string;
          confirmed_at?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          challenge_hash?: string;
          confirmed_at?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'auth_login_requests_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      auth_sessions: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          last_seen_at: string;
          revoked_at: string | null;
          token_hash: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          last_seen_at?: string;
          revoked_at?: string | null;
          token_hash: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_seen_at?: string;
          revoked_at?: string | null;
          token_hash?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'auth_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      credit_products: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          credit_amount: number | null;
          currency: string;
          id: string;
          name: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
          price: number | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          credit_amount?: number | null;
          currency?: string;
          id?: string;
          name: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
          price?: number | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          credit_amount?: number | null;
          currency?: string;
          id?: string;
          name?: string;
          name_en?: string;
          name_ru?: string;
          name_uz?: string;
          price?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          reason: string | null;
          reference_id: string | null;
          source: string | null;
          type: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          reason?: string | null;
          reference_id?: string | null;
          source?: string | null;
          type: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          bucket_type?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          reason?: string | null;
          reference_id?: string | null;
          source?: string | null;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credit_transactions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'admin_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'credit_transactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      lawyer_profiles: {
        Row: {
          bio: string | null;
          consultation_price: number | null;
          created_at: string;
          experience_years: number | null;
          id: string;
          jobs_count: number;
          profile_image_path: string | null;
          public_slug: string;
          rating_average: number;
          rating_count: number;
          region: string | null;
          updated_at: string;
          user_id: string;
          verification_status: string;
          verified_at: string | null;
        };
        Insert: {
          bio?: string | null;
          consultation_price?: number | null;
          created_at?: string;
          experience_years?: number | null;
          id?: string;
          jobs_count?: number;
          profile_image_path?: string | null;
          public_slug: string;
          rating_average?: number;
          rating_count?: number;
          region?: string | null;
          updated_at?: string;
          user_id: string;
          verification_status?: string;
          verified_at?: string | null;
        };
        Update: {
          bio?: string | null;
          consultation_price?: number | null;
          created_at?: string;
          experience_years?: number | null;
          id?: string;
          jobs_count?: number;
          profile_image_path?: string | null;
          public_slug?: string;
          rating_average?: number;
          rating_count?: number;
          region?: string | null;
          updated_at?: string;
          user_id?: string;
          verification_status?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lawyer_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      lawyer_specializations: {
        Row: {
          lawyer_id: string;
          specialization_id: string;
        };
        Insert: {
          lawyer_id: string;
          specialization_id: string;
        };
        Update: {
          lawyer_id?: string;
          specialization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lawyer_specializations_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lawyer_specializations_specialization_id_fkey';
            columns: ['specialization_id'];
            isOneToOne: false;
            referencedRelation: 'specializations';
            referencedColumns: ['id'];
          },
        ];
      };
      lawyer_verifications: {
        Row: {
          created_at: string;
          id: string;
          lawyer_id: string;
          reject_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          submitted_at: string | null;
          submitted_data: Json;
          type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lawyer_id: string;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitted_data?: Json;
          type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lawyer_id?: string;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitted_data?: Json;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lawyer_verifications_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lawyer_verifications_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'admin_accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_accept_products: {
        Row: {
          accept_count: number;
          active: boolean;
          code: string;
          created_at: string;
          currency: string;
          expires_in_days: number | null;
          id: string;
          name: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
          price: number;
          updated_at: string;
        };
        Insert: {
          accept_count: number;
          active?: boolean;
          code: string;
          created_at?: string;
          currency?: string;
          expires_in_days?: number | null;
          id?: string;
          name: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
          price: number;
          updated_at?: string;
        };
        Update: {
          accept_count?: number;
          active?: boolean;
          code?: string;
          created_at?: string;
          currency?: string;
          expires_in_days?: number | null;
          id?: string;
          name?: string;
          name_en?: string;
          name_ru?: string;
          name_uz?: string;
          price?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      marketplace_accept_transactions: {
        Row: {
          amount: number;
          balance_after: number;
          created_at: string;
          expires_at: string | null;
          id: string;
          lawyer_id: string;
          reference_id: string | null;
          type: string;
        };
        Insert: {
          amount: number;
          balance_after: number;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          lawyer_id: string;
          reference_id?: string | null;
          type: string;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          lawyer_id?: string;
          reference_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_accept_transactions_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_acceptances: {
        Row: {
          accepted_at: string;
          closed_at: string | null;
          created_at: string;
          id: string;
          lawyer_id: string;
          ledger_transaction_id: string;
          marketplace_post_id: string;
          public_id: string;
          selected_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string;
          closed_at?: string | null;
          created_at?: string;
          id?: string;
          lawyer_id: string;
          ledger_transaction_id: string;
          marketplace_post_id: string;
          public_id: string;
          selected_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string;
          closed_at?: string | null;
          created_at?: string;
          id?: string;
          lawyer_id?: string;
          ledger_transaction_id?: string;
          marketplace_post_id?: string;
          public_id?: string;
          selected_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_acceptances_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_acceptances_ledger_transaction_id_fkey';
            columns: ['ledger_transaction_id'];
            isOneToOne: true;
            referencedRelation: 'marketplace_accept_transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_acceptances_marketplace_post_id_fkey';
            columns: ['marketplace_post_id'];
            isOneToOne: false;
            referencedRelation: 'marketplace_posts';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_posts: {
        Row: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          additional_details?: string | null;
          cancelled_at?: string | null;
          channel_message_id?: number | null;
          created_at?: string;
          description?: string | null;
          draft_step?: string;
          expires_at?: string | null;
          id?: string;
          idempotency_key: string;
          language?: string;
          max_acceptances?: number;
          public_id: string;
          publish_attempts?: number;
          publish_status?: string;
          published_at?: string | null;
          region?: string | null;
          selected_acceptance_id?: string | null;
          selected_at?: string | null;
          specialization_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          additional_details?: string | null;
          cancelled_at?: string | null;
          channel_message_id?: number | null;
          created_at?: string;
          description?: string | null;
          draft_step?: string;
          expires_at?: string | null;
          id?: string;
          idempotency_key?: string;
          language?: string;
          max_acceptances?: number;
          public_id?: string;
          publish_attempts?: number;
          publish_status?: string;
          published_at?: string | null;
          region?: string | null;
          selected_acceptance_id?: string | null;
          selected_at?: string | null;
          specialization_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_posts_selected_acceptance_fkey';
            columns: ['selected_acceptance_id'];
            isOneToOne: false;
            referencedRelation: 'marketplace_acceptances';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_posts_specialization_id_fkey';
            columns: ['specialization_id'];
            isOneToOne: false;
            referencedRelation: 'specializations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_posts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_reviews: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string;
          lawyer_id: string;
          marketplace_post_id: string;
          rating: number;
          user_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          lawyer_id: string;
          marketplace_post_id: string;
          rating: number;
          user_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          lawyer_id?: string;
          marketplace_post_id?: string;
          rating?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_reviews_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_reviews_marketplace_post_id_fkey';
            columns: ['marketplace_post_id'];
            isOneToOne: true;
            referencedRelation: 'marketplace_posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_reviews_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          amount_money: number;
          created_at: string;
          currency: string;
          failed_at: string | null;
          id: string;
          idempotency_key: string;
          paid_at: string | null;
          product_code: string;
          product_id: string;
          product_units: number;
          provider: string;
          provider_payment_id: string | null;
          status: string;
          type: string;
          user_id: string;
        };
        Insert: {
          amount_money: number;
          created_at?: string;
          currency?: string;
          failed_at?: string | null;
          id?: string;
          idempotency_key: string;
          paid_at?: string | null;
          product_code: string;
          product_id: string;
          product_units: number;
          provider: string;
          provider_payment_id?: string | null;
          status?: string;
          type: string;
          user_id: string;
        };
        Update: {
          amount_money?: number;
          created_at?: string;
          currency?: string;
          failed_at?: string | null;
          id?: string;
          idempotency_key?: string;
          paid_at?: string | null;
          product_code?: string;
          product_id?: string;
          product_units?: number;
          provider?: string;
          provider_payment_id?: string | null;
          status?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      specializations: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          name_en: string;
          name_ru: string;
          name_uz: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          name_en?: string;
          name_ru?: string;
          name_uz?: string;
        };
        Relationships: [];
      };
      user_tags: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          metadata: Json;
          tag: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          metadata?: Json;
          tag: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          metadata?: Json;
          tag?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_tags_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          active_mode: string;
          created_at: string;
          duid: string;
          full_name: string | null;
          id: string;
          language: string | null;
          onboarding_role: string | null;
          onboarding_status: string;
          pin_failed_attempts: number;
          pin_hash: string | null;
          pin_locked_until: string | null;
          status: string;
          telegram_first_name: string | null;
          telegram_user_id: number;
          telegram_username: string | null;
          terms_accepted_at: string | null;
          terms_version: string | null;
          updated_at: string;
        };
        Insert: {
          active_mode?: string;
          created_at?: string;
          duid: string;
          full_name?: string | null;
          id?: string;
          language?: string | null;
          onboarding_role?: string | null;
          onboarding_status?: string;
          pin_failed_attempts?: number;
          pin_hash?: string | null;
          pin_locked_until?: string | null;
          status?: string;
          telegram_first_name?: string | null;
          telegram_user_id: number;
          telegram_username?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          updated_at?: string;
        };
        Update: {
          active_mode?: string;
          created_at?: string;
          duid?: string;
          full_name?: string | null;
          id?: string;
          language?: string | null;
          onboarding_role?: string | null;
          onboarding_status?: string;
          pin_failed_attempts?: number;
          pin_hash?: string | null;
          pin_locked_until?: string | null;
          status?: string;
          telegram_first_name?: string | null;
          telegram_user_id?: number;
          telegram_username?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      verification_documents: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          mime_type: string;
          original_filename: string;
          size_bytes: number;
          storage_bucket: string;
          storage_path: string;
          verification_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          mime_type: string;
          original_filename: string;
          size_bytes: number;
          storage_bucket: string;
          storage_path: string;
          verification_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          mime_type?: string;
          original_filename?: string;
          size_bytes?: number;
          storage_bucket?: string;
          storage_path?: string;
          verification_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'verification_documents_verification_id_fkey';
            columns: ['verification_id'];
            isOneToOne: false;
            referencedRelation: 'lawyer_verifications';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_balance: {
        Args: { p_lawyer_id: string; p_now?: string };
        Returns: {
          balance: number;
          next_expiry: string;
        }[];
      };
      accept_marketplace_post: {
        Args: {
          p_acceptance_public_id: string;
          p_now?: string;
          p_public_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      cancel_marketplace_post: {
        Args: { p_now?: string; p_public_id: string; p_user_id: string };
        Returns: Json;
      };
      create_marketplace_draft: {
        Args: {
          p_idempotency_key: string;
          p_language: string;
          p_now?: string;
          p_public_id: string;
          p_user_id: string;
        };
        Returns: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_posts';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_marketplace_post: {
        Args: {
          p_additional_details: string;
          p_description: string;
          p_expires_at?: string;
          p_idempotency_key: string;
          p_language: string;
          p_now?: string;
          p_public_id: string;
          p_region: string;
          p_specialization_code: string;
          p_user_id: string;
        };
        Returns: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_posts';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      credit_balance: {
        Args: { p_now?: string; p_user_id: string };
        Returns: {
          bonus: number;
          next_expiry: string;
          paid: number;
          total: number;
          weekly: number;
        }[];
      };
      debit_accept: {
        Args: { p_lawyer_id: string; p_now?: string; p_reference_id: string };
        Returns: {
          amount: number;
          balance_after: number;
          created_at: string;
          expires_at: string | null;
          id: string;
          lawyer_id: string;
          reference_id: string | null;
          type: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_accept_transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      debit_credits: {
        Args: {
          p_amount: number;
          p_now?: string;
          p_reason?: string;
          p_reference_id: string;
          p_source: string;
          p_type: string;
          p_user_id: string;
        };
        Returns: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          reason: string | null;
          reference_id: string | null;
          source: string | null;
          type: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'credit_transactions';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      expire_marketplace_posts: { Args: { p_now?: string }; Returns: number };
      grant_accepts: {
        Args: {
          p_amount: number;
          p_expires_at?: string;
          p_lawyer_id: string;
          p_now?: string;
          p_reference_id: string;
          p_type: string;
        };
        Returns: {
          amount: number;
          balance_after: number;
          created_at: string;
          expires_at: string | null;
          id: string;
          lawyer_id: string;
          reference_id: string | null;
          type: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_accept_transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      grant_admin_credit_bonus: {
        Args: {
          p_admin_id: string;
          p_amount: number;
          p_now?: string;
          p_reason: string;
          p_reference_id: string;
          p_user_id: string;
        };
        Returns: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          reason: string | null;
          reference_id: string | null;
          source: string | null;
          type: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'credit_transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      grant_credit: {
        Args: {
          p_amount: number;
          p_bucket_type: string;
          p_created_by?: string;
          p_expires_at?: string;
          p_now?: string;
          p_reason?: string;
          p_reference_id: string;
          p_source: string;
          p_type: string;
          p_user_id: string;
        };
        Returns: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          reason: string | null;
          reference_id: string | null;
          source: string | null;
          type: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'credit_transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      grant_weekly_credits: { Args: { p_now?: string }; Returns: number };
      grant_welcome_credit: {
        Args: { p_now?: string; p_user_id: string };
        Returns: {
          amount: number;
          balance_after: number;
          bucket_type: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          reason: string | null;
          reference_id: string | null;
          source: string | null;
          type: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'credit_transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      process_payment_webhook: {
        Args: {
          p_now?: string;
          p_payment_id: string;
          p_provider: string;
          p_provider_payment_id: string;
          p_status: string;
        };
        Returns: {
          payment_id: string;
          payment_status: string;
          processed: boolean;
        }[];
      };
      publish_marketplace_post: {
        Args: {
          p_expires_at?: string;
          p_now?: string;
          p_public_id: string;
          p_user_id: string;
        };
        Returns: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_posts';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_marketplace_publication: {
        Args: {
          p_channel_message_id: number;
          p_now?: string;
          p_public_id: string;
        };
        Returns: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_posts';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_marketplace_publication_failure: {
        Args: { p_public_id: string };
        Returns: {
          additional_details: string | null;
          cancelled_at: string | null;
          channel_message_id: number | null;
          created_at: string;
          description: string | null;
          draft_step: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          language: string;
          max_acceptances: number;
          public_id: string;
          publish_attempts: number;
          publish_status: string;
          published_at: string | null;
          region: string | null;
          selected_acceptance_id: string | null;
          selected_at: string | null;
          specialization_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'marketplace_posts';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_lawyer_verification: {
        Args: {
          p_admin_id: string;
          p_decision: string;
          p_reject_reason?: string;
          p_verification_id: string;
        };
        Returns: {
          decision: string;
          lawyer_id: string;
          verification_id: string;
        }[];
      };
      select_marketplace_lawyer: {
        Args: {
          p_acceptance_public_id: string;
          p_now?: string;
          p_post_public_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      submit_marketplace_review: {
        Args: {
          p_comment?: string;
          p_now?: string;
          p_post_public_id: string;
          p_rating: number;
          p_user_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
