"use client";

import { forgotPasswordSchema } from "@/backend/schemas/forgotPasswordSchema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { ApiResponse } from "@/types/ApiResponse";
import { zodResolver } from "@hookform/resolvers/zod";
import axios, { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

function ForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{
    identifier: string;
  }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session && session.user) {
      router.push("/dashboard");
      return;
    }
  }, [session, router]);

  const [loading, setLoading] = useState<boolean>(false);

  const { identifier } = use(searchParams);

  useEffect(() => {
    if (identifier) {
      form.setValue("identifier", identifier);
    }
  }, [identifier]);

  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      identifier: identifier || "",
    },
  });

  const watchFields = form.watch(["identifier"]);
  const isButtonDisabled = watchFields.some((field) => !field) || loading;

  const onSubmit = async (data: z.infer<typeof forgotPasswordSchema>) => {
    try {
      setLoading(true);
      const response = await axios.post("/api/forgot-password", {
        identifier: data.identifier,
      });

      toast({
        title: "Success",
        description:
          response.data.message || "Forgot password Code sent successfully",
      });

      router.replace(`/verify-forgot-password?identifier=${data.identifier}`);
    } catch (error) {
      console.error("Error in resetting password", error);

      const axiosError = error as AxiosError<ApiResponse>;

      const errorMessage =
        axiosError.response?.data.message ||
        "Some error occurred. Please try again later";

      toast({
        title: "Forgot Password Code Not Sent",
        description: errorMessage,
        variant: "destructive",
      });

      if (
        errorMessage ===
        "Error in forgot password: Error: No user found with this username or email"
      ) {
        router.replace(`/sign-up?identifier=${data.identifier}`);
      }
    } finally {
      setLoading(false);
      form.reset();
    }
  };

  return (
    <main className="auth-page flex items-center justify-center">
      <div className="auth-card w-full space-y-6">
        <div className="text-center">
          <h1 className="mb-4">
            Forgot Your Password
          </h1>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Username or Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Enter your username or email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="auth-submit-button w-full"
              disabled={isButtonDisabled || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                </>
              ) : (
                "Submit"
              )}
            </Button>
          </form>
        </Form>
      </div>
    </main>
  );
}

export default ForgotPassword;
