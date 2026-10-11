"use client";

import { signInSchema } from "@/backend/schemas/signInSchema";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

function SignIn({
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

  const [isSubmitting, setIsSubmitting] = useState(false);

  const { identifier } = use(searchParams);

  useEffect(() => {
    if (identifier) {
      form.setValue("identifier", identifier);
    }
  }, [identifier]);

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      identifier: identifier || "",
      password: "",
    },
  });

  const watchFields = form.watch(["identifier", "password"]);
  const isButtonDisabled = watchFields.some((field) => !field) || isSubmitting;

  const onSubmit = async (data: z.infer<typeof signInSchema>) => {
    setIsSubmitting(true);
    const result = await signIn("credentials", {
      redirect: false,
      baseUrl: window.location.origin,
      identifier: data.identifier.toLowerCase(),
      password: data.password,
    });

    if (result?.error || !result?.ok) {
      toast({
        title: "Login failed",
        description:
          result?.error === "CredentialsSignin"
            ? "Invalid username or password"
            : "Check Verify or Credentials",
        variant: "destructive",
      });
    } else if (result?.url) {
      router.replace("/dashboard");
    }

    setIsSubmitting(false);
  };

  return (
    <main className="auth-page flex items-center justify-center">
      <div className="auth-card w-full space-y-6">
        <div className="text-center">
          <h1 className="mb-4">
            Welcome back
          </h1>
          <p className="text-muted-foreground">
            Sign in to open your private inbox and see what your people have shared.
          </p>
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
                      placeholder="Username or Email"
                      {...field}
                      type="text"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Password
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Password"
                      type="password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-center w-full">
              <Button
                type="submit"
                disabled={isButtonDisabled || isSubmitting}
                className="auth-submit-button"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Please
                    wait
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </div>
          </form>
        </Form>

        <div className="text-center">
          <p className="text-muted-foreground">
            Forgot your password?{" "}
            <Link
              href={{
                pathname: "/forgot-password",
                query: {
                  identifier: form.getValues("identifier")
                    ? form.getValues("identifier")
                    : identifier,
                },
              }}
              className="auth-link"
            >
              Forgot Password
            </Link>
          </p>
        </div>

        <div className="text-center">
          <p className="text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={{
                pathname: "/sign-up",
                query: {
                  identifier: form.getValues("identifier")
                    ? form.getValues("identifier")
                    : identifier,
                },
              }}
              className="auth-link"
            >
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default SignIn;
