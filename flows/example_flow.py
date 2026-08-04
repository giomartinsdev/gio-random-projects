from prefect import flow, task


@task
def say_hello(name: str) -> str:
    return f"Hello, {name}!"


@flow(log_prints=True)
def example_flow(name: str = "gio"):
    message = say_hello(name)
    print(message)
    return message


if __name__ == "__main__":
    example_flow()
