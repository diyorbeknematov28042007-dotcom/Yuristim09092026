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
